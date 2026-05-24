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

  // Reduce to latest reading per MAC (lowest noise, 1 update per pill per batch)
  const latestByMac = new Map<string, typeof readings[number]>();
  for (const r of readings) {
    const key = normMac(r.mac);
    const cur = latestByMac.get(key);
    if (!cur || new Date(r.recorded_at) > new Date(cur.recorded_at)) {
      latestByMac.set(key, r);
    }
  }

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

  for (const [mac, r] of latestByMac) {
    const pillId = macToPill.get(mac);
    if (!pillId) {
      skipped++;
      continue;
    }

    // Update rapt_pills (BLE is now SSOT for pill telemetry)
    const update: Record<string, unknown> = {
      last_update: r.recorded_at,
      updated_at: new Date().toISOString(),
    };
    if (r.temp_c != null) update.temperature = r.temp_c;
    if (r.gravity_sg != null) update.gravity = r.gravity_sg;
    if (r.battery_pct != null) update.battery_level = r.battery_pct;

    const { error: upErr } = await supabase
      .from('rapt_pills')
      .update(update)
      .eq('pill_id', pillId);
    if (upErr) {
      errors.push(`pill ${pillId}: ${upErr.message}`);
      continue;
    }

    // BLE = SSOT for actual_temp. Promote pill temp to the linked controller
    // so PID and UI read a fresh value every minute, independent of RAPT sync.
    const controllerId = pillToController.get(pillId);
    if (controllerId && r.temp_c != null) {
      const { error: ctrlErr } = await supabase
        .from('rapt_temp_controllers')
        .update({
          actual_temp: r.temp_c,
          pill_temp: r.temp_c,
          pill_temp_at: r.recorded_at,
          last_update: r.recorded_at,
          updated_at: new Date().toISOString(),
        })
        .eq('controller_id', controllerId);
      if (ctrlErr) errors.push(`ctrl ${controllerId}: ${ctrlErr.message}`);
    }

    // If linked to active brew → write snapshot + update brew_readings
    const brew = pillToBrew.get(pillId);
    if (brew && r.gravity_sg != null && r.temp_c != null) {
      // Skip if before fermentation start
      if (brew.fermentation_start && new Date(r.recorded_at) < new Date(brew.fermentation_start)) {
        processed++;
        continue;
      }

      // Fetch controller actual_temp for SSOT
      let actualTemp: number | null = r.temp_c;
      let controllerTemp: number | null = null;
      let profileTargetTemp: number | null = null;
      if (brew.linked_controller_id) {
        const { data: ctrl } = await supabase
          .from('rapt_temp_controllers')
          .select('actual_temp, current_temp, profile_target_temp')
          .eq('controller_id', brew.linked_controller_id)
          .maybeSingle();
        if (ctrl) {
          actualTemp = ctrl.actual_temp ?? r.temp_c;
          controllerTemp = ctrl.current_temp ?? null;
          profileTargetTemp = ctrl.profile_target_temp ?? null;
        }
      }

      try {
        await createBrewSnapshot(supabase, brew.id, {
          recorded_at: r.recorded_at,
          sg: r.gravity_sg,
          pill_temp: r.temp_c,
          controller_temp: controllerTemp,
          profile_target_temp: profileTargetTemp,
          actual_temp: actualTemp,
        });
      } catch (e) {
        errors.push(`snapshot ${brew.name}: ${(e as Error).message}`);
      }

      // Update brew_readings latest metrics
      const og = brew.original_gravity;
      const sg = r.gravity_sg;
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

  return json({ processed, skipped, errors, pills_known: macToPill.size });
});