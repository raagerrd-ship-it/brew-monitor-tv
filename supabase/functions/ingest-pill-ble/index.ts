import { createClient } from 'npm:@supabase/supabase-js@2.58.0';
import { z } from 'npm:zod@3.23.8';
import { createBrewSnapshot } from '../_shared/brew-snapshots.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-pi-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ReadingSchema = z.object({
  mac: z.string().min(6).max(64),
  temp_c: z.number().min(-20).max(60).nullable().optional(),
  gravity_sg: z.number().min(0.9).max(1.3).nullable().optional(),
  battery_pct: z.number().int().min(0).max(100).nullable().optional(),
  rssi: z.number().int().min(-120).max(0).nullable().optional(),
  recorded_at: z.string().datetime(),
});

const BodySchema = z.object({
  readings: z.array(ReadingSchema).max(500),
  heartbeat: z.boolean().optional(),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Normalize MAC: lowercase, no colons
function normMac(s: string): string {
  return s.toLowerCase().replace(/[^a-f0-9]/g, '');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const expected = Deno.env.get('PI_BLE_INGEST_SECRET');
  const provided = req.headers.get('x-pi-secret');
  if (!expected || !provided || provided !== expected) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let parsed;
  try {
    const raw = await req.json();
    parsed = BodySchema.safeParse(raw);
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!parsed.success) {
    return json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { readings, heartbeat } = parsed.data;

  if (heartbeat && readings.length === 0) {
    return json({ ok: true, heartbeat: true });
  }

  // Track controllers that received fresh BLE data this batch (event-trigger candidates)
  const updatedControllers = new Set<string>();

  // Load all pills with paired_device_id (MAC)
  const { data: pills, error: pillsErr } = await supabase
    .from('rapt_pills')
    .select('pill_id, paired_device_id');
  if (pillsErr) return json({ error: 'DB read failed', details: pillsErr.message }, 500);

  const macToPill = new Map<string, string>();
  for (const p of pills ?? []) {
    if (p.paired_device_id) macToPill.set(normMac(p.paired_device_id), p.pill_id);
  }

  // Load pill→controller map once (so we can promote BLE temp to controller SSOT)
  const { data: linkedControllers } = await supabase
    .from('rapt_temp_controllers')
    .select('controller_id, linked_pill_id')
    .not('linked_pill_id', 'is', null);
  const pillToController = new Map<string, string>();
  for (const c of linkedControllers ?? []) {
    if (c.linked_pill_id) pillToController.set(c.linked_pill_id, c.controller_id);
  }

  // Layer 1 — Batch average per MAC: average all readings for the same pill
  // in this upload (typically 2/min from Pi). Reduces minute-scale noise ~½.
  // Timestamp = most recent recorded_at in the group.
  type Avg = {
    mac: string;
    temp_c: number | null;
    gravity_sg: number | null;
    battery_pct: number | null;
    recorded_at: string;
    sample_count: number;
    // Raw latest values (for snapshots — preserve unfiltered history)
    raw_temp_c: number | null;
    raw_gravity_sg: number | null;
  };
  const groups = new Map<string, typeof readings>();
  for (const r of readings) {
    const key = normMac(r.mac);
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }
  const avgByMac = new Map<string, Avg>();
  for (const [mac, arr] of groups) {
    const sorted = [...arr].sort(
      (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
    );
    const latest = sorted[sorted.length - 1];
    const mean = (vals: (number | null | undefined)[]) => {
      const xs = vals.filter((v): v is number => typeof v === 'number');
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    };
    avgByMac.set(mac, {
      mac,
      temp_c: mean(sorted.map((s) => s.temp_c)),
      gravity_sg: mean(sorted.map((s) => s.gravity_sg)),
      battery_pct: mean(sorted.map((s) => s.battery_pct)),
      recorded_at: latest.recorded_at,
      sample_count: sorted.length,
      raw_temp_c: latest.temp_c ?? null,
      raw_gravity_sg: latest.gravity_sg ?? null,
    });
  }

  // EMA coefficients (Layers 2 & 3)
  // α=0.35 ≈ rolling-3 effective window for temperature (PID stability)
  // α=0.25 ≈ rolling-5 effective window for gravity (noisier signal)
  const ALPHA_TEMP = 0.35;
  const ALPHA_SG = 0.25;
  const ema = (sample: number, prev: number | null | undefined, alpha: number) =>
    prev == null || !Number.isFinite(prev) ? sample : alpha * sample + (1 - alpha) * prev;

  let processed = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Load active brews with pill linkage once
  const { data: activeBrews } = await supabase
    .from('brew_readings')
    .select('id, linked_pill_id, linked_controller_id, original_gravity, fermentation_start, name')
    .in('status', ['fermenting', 'active'])
    .not('linked_pill_id', 'is', null);
  const pillToBrew = new Map<string, any>();
  for (const b of activeBrews ?? []) {
    if (b.linked_pill_id) pillToBrew.set(b.linked_pill_id, b);
  }

  for (const [mac, r] of avgByMac) {
    const pillId = macToPill.get(mac);
    if (!pillId) {
      skipped++;
      continue;
    }

    // Fetch previous smoothed values for EMA continuity
    const { data: prevPill } = await supabase
      .from('rapt_pills')
      .select('temperature, gravity')
      .eq('pill_id', pillId)
      .maybeSingle();

    // Layer 2 & 3 — EMA smoothing
    const smoothedTemp =
      r.temp_c != null ? ema(r.temp_c, prevPill?.temperature ?? null, ALPHA_TEMP) : null;
    const smoothedSg =
      r.gravity_sg != null ? ema(r.gravity_sg, prevPill?.gravity ?? null, ALPHA_SG) : null;

    // Update rapt_pills with smoothed values (BLE = SSOT for pill telemetry)
    const update: Record<string, unknown> = {
      last_update: r.recorded_at,
      updated_at: new Date().toISOString(),
    };
    if (smoothedTemp != null) update.temperature = Number(smoothedTemp.toFixed(3));
    if (smoothedSg != null) update.gravity = Number(smoothedSg.toFixed(5));
    if (r.battery_pct != null) update.battery_level = Math.round(r.battery_pct);

    const { error: upErr } = await supabase
      .from('rapt_pills')
      .update(update)
      .eq('pill_id', pillId);
    if (upErr) {
      errors.push(`pill ${pillId}: ${upErr.message}`);
      continue;
    }

    // BLE = SSOT for actual_temp. Promote pill temp to the linked controller
    // so PID and UI read a fresh (smoothed) value every minute, independent of RAPT sync.
    const controllerId = pillToController.get(pillId);
    if (controllerId && smoothedTemp != null) {
      const { error: ctrlErr } = await supabase
        .from('rapt_temp_controllers')
        .update({
          actual_temp: Number(smoothedTemp.toFixed(3)),
          pill_temp: Number(smoothedTemp.toFixed(3)),
          last_update: r.recorded_at,
          updated_at: new Date().toISOString(),
        })
        .eq('controller_id', controllerId);
      if (ctrlErr) errors.push(`ctrl ${controllerId}: ${ctrlErr.message}`);
      else updatedControllers.add(controllerId);
    }

    // If linked to active brew → write snapshot + update brew_readings
    const brew = pillToBrew.get(pillId);
    if (brew && r.gravity_sg != null && r.temp_c != null) {
      // Skip if before fermentation start
      if (brew.fermentation_start && new Date(r.recorded_at) < new Date(brew.fermentation_start)) {
        processed++;
        continue;
      }

      // Use smoothed temp as actual_temp SSOT; fall back to controller if not linked
      let actualTemp: number | null = smoothedTemp;
      let controllerTemp: number | null = null;
      let profileTargetTemp: number | null = null;
      if (brew.linked_controller_id) {
        const { data: ctrl } = await supabase
          .from('rapt_temp_controllers')
          .select('actual_temp, current_temp, profile_target_temp')
          .eq('controller_id', brew.linked_controller_id)
          .maybeSingle();
        if (ctrl) {
          actualTemp = ctrl.actual_temp ?? smoothedTemp;
          controllerTemp = ctrl.current_temp ?? null;
          profileTargetTemp = ctrl.profile_target_temp ?? null;
        }
      }

      try {
        // Snapshot keeps RAW pill values for history/AI fidelity;
        // actual_temp is the smoothed SSOT used by PID.
        await createBrewSnapshot(supabase, brew.id, {
          recorded_at: r.recorded_at,
          sg: r.raw_gravity_sg ?? r.gravity_sg,
          pill_temp: r.raw_temp_c ?? r.temp_c,
          controller_temp: controllerTemp,
          profile_target_temp: profileTargetTemp,
          actual_temp: actualTemp,
        });
      } catch (e) {
        errors.push(`snapshot ${brew.name}: ${(e as Error).message}`);
      }

      // Update brew_readings latest metrics with smoothed SG for stable ABV/attenuation
      const og = brew.original_gravity;
      const sg = smoothedSg ?? r.gravity_sg;
      const attenuation = og > 1 ? Math.max(0, Math.min(100, Math.round(((og - sg) / (og - 1)) * 100))) : 0;
      const abv = og > 1 ? Math.max(0, Number(((og - sg) * 131.25).toFixed(1))) : 0;

      await supabase
        .from('brew_readings')
        .update({
          current_sg: sg,
          current_temp: actualTemp,
          attenuation,
          abv,
          battery: r.battery_pct ?? null,
          last_update: r.recorded_at,
          updated_at: new Date().toISOString(),
        })
        .eq('id', brew.id);
    }

    processed++;
  }

  // ── Event-trigger PID for fresh BLE-linked controllers ───────────
  // Fire-and-forget. Throttle: max 1 PID run per controller per 90 s,
  // enforced via pid_event_throttle table (UPSERT-then-check).
  // The 5-min rapt-quick-sync cron remains as safety-net.
  let triggered = 0;
  if (updatedControllers.size > 0) {
    const COOLDOWN_MS = 90 * 1000;
    const nowIso = new Date().toISOString();
    const cutoffIso = new Date(Date.now() - COOLDOWN_MS).toISOString();
    const { data: throttleRows } = await supabase
      .from('pid_event_throttle')
      .select('controller_id, last_run_at')
      .in('controller_id', Array.from(updatedControllers));
    const lastRunMap = new Map<string, string>();
    for (const t of throttleRows ?? []) lastRunMap.set(t.controller_id, t.last_run_at);

    const eligible = Array.from(updatedControllers).filter((id) => {
      const last = lastRunMap.get(id);
      return !last || last < cutoffIso;
    });

    if (eligible.length > 0) {
      // Mark cooldown first to avoid races between concurrent ingests
      await supabase
        .from('pid_event_throttle')
        .upsert(
          eligible.map((controller_id) => ({ controller_id, last_run_at: nowIso })),
          { onConflict: 'controller_id' },
        );

      // Fire-and-forget — do not await; ingest latency must stay low
      const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/auto-adjust-cooling`;
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({ trigger: 'ble_event', controllers: eligible }),
      }).catch((e) => console.error('event-trigger fetch failed:', (e as Error).message));
      triggered = eligible.length;
    }
  }

  return json({
    processed,
    skipped,
    errors,
    pills_known: macToPill.size,
    batches: avgByMac.size,
    triggered,
  });
});