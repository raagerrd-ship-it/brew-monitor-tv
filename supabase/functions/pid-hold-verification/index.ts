import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const AVG_ERR_THRESHOLD = 0.30;      // °C — mean |actual - target| over 60 min
const DUTY_STD_THRESHOLD = 25;       // pct-units — oscillation on duty over 60 min
const TARGET_STABLE_MINUTES = 120;   // target must not move >0.1°C during this window
const TARGET_STABLE_TOL = 0.1;
const DEDUPE_HOURS = 4;

function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
  return Math.sqrt(v);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: controllers, error: cErr } = await supabase
    .from('rapt_temp_controllers')
    .select('controller_id, name, profile_target_temp, is_glycol_cooler')
    .not('profile_target_temp', 'is', null)
    .eq('is_glycol_cooler', false);

  if (cErr) {
    return new Response(JSON.stringify({ error: cErr.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const nowIso = new Date().toISOString();
  const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const stableCutoff = Date.now() - TARGET_STABLE_MINUTES * 60 * 1000;
  const dedupeCutoff = new Date(Date.now() - DEDUPE_HOURS * 60 * 60 * 1000).toISOString();

  const results: any[] = [];

  for (const c of controllers ?? []) {
    const { data: hist } = await supabase
      .from('temp_controller_history')
      .select('recorded_at, actual_temp, current_temp, profile_target_temp, duty_pct')
      .eq('controller_id', c.controller_id)
      .gte('recorded_at', threeHoursAgo)
      .order('recorded_at', { ascending: true });

    if (!hist || hist.length < 20) {
      results.push({ controller: c.name, status: 'insufficient-data', rows: hist?.length ?? 0 });
      continue;
    }

    // Target stability across the full stable-window
    const stableRows = hist.filter(r => new Date(r.recorded_at).getTime() >= stableCutoff);
    const targets = stableRows.map(r => Number(r.profile_target_temp)).filter(Number.isFinite);
    if (targets.length < 10) {
      results.push({ controller: c.name, status: 'insufficient-stable-window' });
      continue;
    }
    const tMin = Math.min(...targets);
    const tMax = Math.max(...targets);
    if (tMax - tMin > TARGET_STABLE_TOL) {
      results.push({ controller: c.name, status: 'target-moving', spread: +(tMax - tMin).toFixed(3) });
      continue;
    }

    // Last-hour metrics
    const lastHour = hist.filter(r => new Date(r.recorded_at).getTime() >= oneHourAgo);
    const errs = lastHour
      .map(r => {
        const a = Number(r.actual_temp ?? r.current_temp);
        const t = Number(r.profile_target_temp);
        return Number.isFinite(a) && Number.isFinite(t) ? Math.abs(a - t) : null;
      })
      .filter((x): x is number => x !== null);
    const duties = lastHour
      .map(r => Number(r.duty_pct))
      .filter(Number.isFinite);

    if (errs.length < 10) {
      results.push({ controller: c.name, status: 'insufficient-last-hour' });
      continue;
    }

    const avgErr = errs.reduce((a, b) => a + b, 0) / errs.length;
    const dutyStd = std(duties);
    const dutyMean = duties.length ? duties.reduce((a, b) => a + b, 0) / duties.length : 0;

    const highErr = avgErr > AVG_ERR_THRESHOLD;
    const oscillating = dutyStd > DUTY_STD_THRESHOLD;

    const summary = {
      controller: c.name,
      controller_id: c.controller_id,
      target: targets[targets.length - 1],
      avg_err: +avgErr.toFixed(3),
      duty_mean: +dutyMean.toFixed(1),
      duty_std: +dutyStd.toFixed(1),
      status: highErr || oscillating ? 'warn' : 'ok',
      reasons: [
        highErr ? `avg_err ${avgErr.toFixed(2)}°C > ${AVG_ERR_THRESHOLD}` : null,
        oscillating ? `duty_std ${dutyStd.toFixed(1)} > ${DUTY_STD_THRESHOLD}` : null,
      ].filter(Boolean),
    };
    results.push(summary);

    if (!highErr && !oscillating) continue;

    // Dedupe: has a pid_hold_warning fired for this controller within DEDUPE_HOURS?
    const { data: recent } = await supabase
      .from('pending_notifications')
      .select('id')
      .eq('type', 'pid_hold_warning')
      .eq('controller_id', c.controller_id)
      .gte('created_at', dedupeCutoff)
      .limit(1);

    if (recent && recent.length > 0) continue;

    const title = `PID hold-varning: ${c.name}`;
    const body =
      `Target ${targets[targets.length - 1]}°C stabil i ${TARGET_STABLE_MINUTES}min. ` +
      `Snitt-fel senaste timmen: ${avgErr.toFixed(2)}°C, ` +
      `duty ${dutyMean.toFixed(0)}% ±${dutyStd.toFixed(0)}%. ` +
      (highErr ? 'PID håller inte temperaturen. ' : '') +
      (oscillating ? 'Duty oscillerar — I-term har inte konvergerat. ' : '');

    await supabase.from('pending_notifications').insert({
      type: 'pid_hold_warning',
      title,
      body,
      controller_id: c.controller_id,
      created_at: nowIso,
    });
  }

  return new Response(JSON.stringify({ checked_at: nowIso, results }, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});