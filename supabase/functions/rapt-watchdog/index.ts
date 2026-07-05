import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

// Tunable thresholds
const STALE_THRESHOLD_MIN = 31;
const COOLDOWN_MIN = 35;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  try {
    // 1. fetch monitored brewing controllers (skip glycol coolers)
    const { data: controllers, error: cErr } = await supabase
      .from('rapt_temp_controllers')
      .select('controller_id,name,current_temp_updated_at,is_glycol_cooler')
      .or('is_glycol_cooler.is.null,is_glycol_cooler.eq.false');
    if (cErr) throw cErr;

    const now = Date.now();
    const stale: { name: string; controller_id: string; last_update: string | null; ageMin: number }[] = [];

    for (const c of controllers ?? []) {
      // Use RAPT's lastActivityTime (probe freshness) — `last_update` is stamped
      // to now() on every successful poll and lies when the RAPT cloud caches
      // stale telemetry.
      if (!c.current_temp_updated_at) continue;
      const ageMin = (now - new Date(c.current_temp_updated_at).getTime()) / 60000;
      if (ageMin > STALE_THRESHOLD_MIN) {
        stale.push({
          name: c.name ?? c.controller_id,
          controller_id: c.controller_id,
          last_update: c.current_temp_updated_at,
          ageMin,
        });
      }
    }

    if (stale.length === 0) {
      return new Response(
        JSON.stringify({ checked: controllers?.length ?? 0, stale: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // 2. cooldown check — any watchdog restart in last COOLDOWN_MIN?
    const cooldownCutoff = new Date(now - COOLDOWN_MIN * 60_000).toISOString();
    const { data: recent, error: rErr } = await supabase
      .from('plug_commands')
      .select('id,created_at')
      .eq('source', 'watchdog')
      .eq('command', 'restart')
      .gte('created_at', cooldownCutoff)
      .order('created_at', { ascending: false })
      .limit(1);
    if (rErr) throw rErr;

    const inCooldown = (recent?.length ?? 0) > 0;
    const action = inCooldown ? 'cooldown_skipped' : 'restart_triggered';

    // 3. log every stale detection
    const logRows = stale.map((s) => ({
      controller: s.name,
      last_reading_at: s.last_update,
      age_minutes: Number(s.ageMin.toFixed(2)),
      action,
    }));
    const { error: lErr } = await supabase.from('watchdog_log').insert(logRows);
    if (lErr) console.error('watchdog_log insert failed:', lErr);

    // 4. queue restart unless in cooldown
    if (!inCooldown) {
      const { error: pErr } = await supabase
        .from('plug_commands')
        .insert({ command: 'restart', source: 'watchdog' });
      if (pErr) throw pErr;
    }

    return new Response(
      JSON.stringify({
        checked: controllers?.length ?? 0,
        stale: stale.length,
        action,
        controllers: stale.map((s) => ({ name: s.name, ageMin: Number(s.ageMin.toFixed(1)) })),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('rapt-watchdog error:', err);
    return new Response(
      JSON.stringify({ error: String((err as Error).message ?? err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});