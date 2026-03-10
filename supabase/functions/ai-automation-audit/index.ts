import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Check if AI audit is enabled + get cooler info for idle detection
    const [{ data: coolingSettings }, { data: runningSessions }] = await Promise.all([
      supabase
        .from('auto_cooling_settings')
        .select('ai_audit_enabled, enabled, cooler_controller_id')
        .limit(1)
        .maybeSingle(),
      supabase
        .from('fermentation_sessions')
        .select('id')
        .eq('status', 'running')
        .limit(1),
    ]);
    
    if (coolingSettings && coolingSettings.ai_audit_enabled === false) {
      console.log('🤖 AI automation audit is disabled, skipping.');
      return new Response(JSON.stringify({ skipped: true, reason: 'ai_audit_enabled is false' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ========================================
    // IDLE DETECTION: Skip if no active sessions and cooler is idle
    // ========================================
    const hasRunningSessions = (runningSessions?.length ?? 0) > 0;
    if (!hasRunningSessions) {
      let coolerAtMax = false;
      const autoEnabled = coolingSettings?.enabled ?? false;
      if (autoEnabled && coolingSettings?.cooler_controller_id) {
        const { data: coolerCtrl } = await supabase
          .from('rapt_temp_controllers')
          .select('target_temp, max_target_temp')
          .eq('controller_id', coolingSettings.cooler_controller_id)
          .maybeSingle();
        coolerAtMax = coolerCtrl?.target_temp != null && coolerCtrl?.max_target_temp != null
          && coolerCtrl.target_temp >= coolerCtrl.max_target_temp;
      }
      const systemIsIdle = !autoEnabled || coolerAtMax;
      if (systemIsIdle) {
        console.log('🤖 AI audit skipped: system idle (no running sessions, cooler idle/disabled)');
        await supabase.from('ai_audit_log').insert({
          analysis: 'Skipped — system idle',
          actions_taken: [],
          parameters_changed: [],
          anomalies_detected: [],
          recommendations: [],
          duration_ms: 0,
          prompt_summary: 'idle',
        });
        return new Response(JSON.stringify({ skipped: true, reason: 'system idle' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // ========================================
    // COOLDOWN: Prevent running more than once per 4 hours
    // ========================================
    const AUDIT_COOLDOWN_HOURS = 4;
    const cooldownCutoff = new Date(Date.now() - AUDIT_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();
    const { data: recentAudits } = await supabase
      .from('ai_audit_log')
      .select('id, created_at')
      .gte('created_at', cooldownCutoff)
      .not('analysis', 'like', 'Error:%') // Don't count failed audits
      .limit(1);

    if (recentAudits && recentAudits.length > 0) {
      console.log(`🤖 AI audit cooldown active — last audit at ${recentAudits[0].created_at}, skipping (min ${AUDIT_COOLDOWN_HOURS}h between audits).`);
      return new Response(JSON.stringify({ skipped: true, reason: `cooldown: last audit less than ${AUDIT_COOLDOWN_HOURS}h ago` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('🤖 Starting AI automation audit...');

    // ========================================
    // COLLECT SYSTEM DATA (parallel queries)
    // ========================================
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [
      { data: decisionLogs },
      { data: learnings },
      { data: learnedComp },
      { data: settings },
      { data: controllers },
      { data: boostOutcomes },
      { data: recentAdjustments },
      { data: runningSessions },
      { data: deltaHistory },
      { data: fermentationMetrics },
    ] = await Promise.all([
      // Recent decision logs (last 6h)
      supabase.from('auto_cooling_decision_logs')
        .select('created_at, duration_ms, decision_count, adjustment_made, final_result')
        .gte('created_at', sixHoursAgo)
        .order('created_at', { ascending: false })
        .limit(20),
      // All learned parameters
      supabase.from('fermentation_learnings')
        .select('controller_id, parameter_name, learned_value, sample_count, last_updated_at'),
      // Learned PID compensation baselines
      supabase.from('controller_learned_compensation')
        .select('controller_id, delta_bucket, mode, step_type, learned_pi_correction, accumulated_integral, convergence_count, latest_avg_error, latest_p_correction, latest_i_correction, latest_d_damping'),
      // Current settings
      supabase.from('auto_cooling_settings').select('*').limit(1).single(),
      // Controller states
      supabase.from('rapt_temp_controllers')
        .select('controller_id, name, current_temp, target_temp, pill_temp, cooling_enabled, heating_enabled, is_glycol_cooler, cooling_hysteresis, min_target_temp, max_target_temp, last_update'),
      // Recent boost outcomes
      supabase.from('stall_boost_outcomes')
        .select('controller_id, boost_degrees, sg_rate_before, sg_rate_after, outcome, created_at')
        .gte('created_at', twentyFourHoursAgo)
        .order('created_at', { ascending: false }),
      // Recent adjustments (last 24h)
      supabase.from('auto_cooling_adjustments')
        .select('cooler_controller_id, cooler_controller_name, old_target_temp, new_target_temp, original_target_temp, reason, created_at')
        .gte('created_at', twentyFourHoursAgo)
        .order('created_at', { ascending: false })
        .limit(50),
      // Running fermentation sessions
      supabase.from('fermentation_sessions')
        .select('id, controller_id, profile_id, current_step_index, status, started_at, brew_id')
        .eq('status', 'running'),
      // Recent delta history (last 6h, sampled)
      supabase.from('temp_delta_history')
        .select('controller_id, pill_temp, controller_temp, delta, recorded_at')
        .gte('recorded_at', sixHoursAgo)
        .order('recorded_at', { ascending: false })
        .limit(100),
      // Fermentation metrics for all active brews (phase, activity, attenuation)
      supabase.from('brew_fermentation_metrics')
        .select('brew_id, fermentation_phase, activity_score, sg_rate_per_hour, peak_delta, ready_to_crash, updated_at')
        .order('updated_at', { ascending: false }),
    ]);

    // Fetch active brews to map controller_id → brew_id for fermentation metrics
    const { data: activeBrews } = await supabase
      .from('brew_readings')
      .select('id, linked_controller_id, attenuation, status')
      .not('linked_controller_id', 'is', null);

    // Fetch profile names and step types for running sessions
    const sessionProfileMap = new Map<string, { profile_name: string; active_step_type: string; step_target_temp: number | null }>();
    if (runningSessions && runningSessions.length > 0) {
      const profileIds = [...new Set(runningSessions.map((s: any) => s.profile_id))];
      const [{ data: profiles }, { data: steps }] = await Promise.all([
        supabase.from('fermentation_profiles').select('id, name').in('id', profileIds),
        supabase.from('fermentation_profile_steps').select('profile_id, step_order, step_type, target_temp').in('profile_id', profileIds),
      ]);
      for (const session of runningSessions) {
        const profile = (profiles || []).find((p: any) => p.id === session.profile_id);
        const currentStep = (steps || []).find((s: any) => s.profile_id === session.profile_id && s.step_order === session.current_step_index);
        sessionProfileMap.set(session.controller_id, {
          profile_name: profile?.name ?? 'Okänd profil',
          active_step_type: currentStep?.step_type ?? 'unknown',
          step_target_temp: currentStep?.target_temp ?? null,
        });
      }
    }

    // ========================================
    // BUILD PROMPT WITH ALL SYSTEM DATA
    // ========================================
    const systemPrompt = `Du är en expert-AI som övervakar ett automatiserat bryggeri-temperaturkontrollsystem. Din uppgift är att analysera systemets prestanda och göra direkta parameterändringar om det behövs.

## Systemöversikt
- PI(D)-regulator kompenserar för skillnaden mellan pill-temp (vätskans temp) och controller-temp (prob-temp)
- Glykolkylare sänks automatiskt under lägsta följda controller
- Stall-detektion upptäcker avstannad jäsning och applicerar temperatur-boost
- Inlärda parametrar sparas per controller i fermentation_learnings

## KRITISK FYSIKFÖRSTÅELSE — Sensorplacering och delta
- **Probe (controller-temp)** sitter i BOTTEN av jäskärlet, nära kylslangen/glykolmanteln. Den reagerar SNABBT på kylning.
- **Pill (pill-temp)** sitter i TOPPEN av vätskan. Den reagerar LÅNGSAMT på kylning.
- Under **aktiv jäsning**: CO₂-produktion driver värme uppåt → pill blir naturligt varmare än probe → högt delta är FÖRVÄNTAT och normalt. Ändra INTE PID-parametrar pga högt delta under aktiv jäsning.
- Under **cold crash / temperatursänkning**: Om delta (pill - probe) är STORT betyder det att kylningen är FÖR AGGRESSIV — probe sjunker snabbt (nära kylslangen) medan pill hänger kvar (långt från kylning).
   → Rätt åtgärd: ÖKA damping (lugnare PID), MINSKA rate_limit (mindre steg per cykel) — INTE tvärtom!
   → FEL åtgärd: Sänka damping eller öka rate_limit — det gör kylningen ännu mer aggressiv och ÖKAR delta.
- Tumregel: Stort delta + låg jäsningsaktivitet = kylningen driver för hårt. Lösning = lugnare reglering.

## KRITISK DEFINITION: Cold Crash vs Normal Hold
- **Cold crash** = måltemperaturen AKTIVT SÄNKS mot ≤4°C via ett ramp-steg. Stegtypen är typiskt 'ramp' med target_temp ≤ 4°C.
- **Normal lagerjäsning** = temperatur hålls STABIL vid 6-18°C via ett 'hold'-steg. Detta är INTE cold crash, oavsett delta eller jäsningsfas.
- Varje controller har nu fälten 'active_step_type' och 'profile_name'. Använd dessa för att avgöra om controllern gör cold crash eller bara håller temperatur.
- Om active_step_type = 'hold' eller 'wait_for_sg' eller 'wait_for_gravity_stable' → det är INTE cold crash. Delta kan vara normalt pga fysik.
- Om active_step_type = 'ramp' OCH step_target_temp ≤ 4°C → DÅ är det cold crash.

## Regler för parameterändringar
- Du FÅR ändra parametrar direkt. Returnera dem i "parameter_changes".
- Ändra bara om det finns tydlig evidens (oscillering, konvergensfel, ineffektiva boosts).
- Var konservativ — små steg (10-25% åt gången).
- Motivera VARJE ändring med data.
- Vid högt delta under cold crash: ÖKA damping, MINSKA rate_limit. ALDRIG tvärtom.

## Parametrar du kan ändra (i auto_cooling_settings):

### PID-kompensation
- pill_compensation_damping (0.1-0.9): Hur snabbt PID reagerar. Höj vid oscillering. MAX ÄNDRING: ±0.1 per audit.
- pill_compensation_rate_limit (0.1-1.0): Max ändring per cykel. MAX ÄNDRING: ±0.1 per audit.
- pill_compensation_max_compensation (1.0-8.0): Max total kompensation. MAX ÄNDRING: ±0.5 per audit.
- pill_compensation_min_scale (0.05-0.5): Lägsta skalningsfaktor för PID nära target. Sänk om systemet blir för passivt nära target. MAX ÄNDRING: ±0.05 per audit.
- pill_compensation_emergency_threshold (1.0-5.0): Nödlägeströskel — om felet överstiger detta ignoreras damping. Sänk om systemet reagerar för långsamt på stora avvikelser. MAX ÄNDRING: ±0.5 per audit.

### Overshoot-skydd
- overshoot_pill_threshold (0.1-1.0): Marginal innan pill-overshoot-guard triggas. Sänk om pill skjuter över target, höj om PID bromsas i onödan. MAX ÄNDRING: ±0.1 per audit.
- overshoot_delta_threshold (0.5-5.0): Delta-tröskel för overshoot-prevention. MAX ÄNDRING: ±0.5 per audit.

### Stall-detektering
- stall_rate_threshold (0.0005-0.005): SG-tröskelvärde för stall-detektion. MAX ÄNDRING: ±0.0005 per audit.
- auto_boost_degrees (0.5-4.0): Standard boost-grader vid stall. Höj om boosts inte bryter stalls. MAX ÄNDRING: ±0.5 per audit.
- stall_min_attenuation (5-30): Minsta dämpning (%) innan stall-detektion aktiveras. Sänk om stalls missas tidigt. MAX ÄNDRING: ±5 per audit.
- stall_max_attenuation (70-95): Högsta dämpning (%) för stall-detektion. Höj om stalls missas sent. MAX ÄNDRING: ±5 per audit.

### Kylare
- delta_alert_threshold (0.5-5.0): Tröskelvärde för delta-alarm. MAX ÄNDRING: ±0.5 per audit.
- temp_reduction_degrees (1.0-10.0): Hur mycket glykolkylaren sänks under lägsta target. MAX ÄNDRING: ±1.0 per audit.
- max_diff_from_lowest (3.0-15.0): Max avstånd kylaren går under lägsta följda controllers target. Höj om kylaren inte hinner, sänk om den kyler för aggressivt. MAX ÄNDRING: ±1.0 per audit.

### Smart Relay
- smart_relay_min_hysteresis (0.1-1.0): Minsta hysteres smart relay tillåter. Sänk för tightare kontroll, höj om reläet cyklar för ofta. MAX ÄNDRING: ±0.1 per audit.
- smart_relay_cooling_only_below (0-10): Temperatur under target där enbart kylning aktiveras (stänger av värme). Sänk om värme stör kylningen, höj om systemet tappar värme för tidigt. MAX ÄNDRING: ±1.0 per audit.
- smart_relay_heating_only_above (0-10): Temperatur över target där enbart värme aktiveras (stänger av kylning). Sänk om kylning stör uppvärmning, höj om systemet tappar kylning för tidigt. MAX ÄNDRING: ±1.0 per audit.
- smart_relay_tighten_after_minutes (5-60): Minuter innan smart relay börjar strama åt hysteres. Sänk för snabbare anpassning, höj om reläet cyklar för tidigt. MAX ÄNDRING: ±5 per audit.

VIKTIGT: Gör ALDRIG stora hopp. Små steg (max 10-15% av nuvarande värde). Om du vill göra en större ändring, dela upp den över flera audit-cykler.

FÖRBJUDET: Du får ALDRIG ändra booleska on/off-inställningar (enabled, auto_boost_enabled, pill_compensation_enabled, overshoot_prevention_enabled, smart_relay_enabled, sg_temp_correction_enabled, etc.). Dessa styrs ENBART av användaren. Försök inte heller ändra check_interval_minutes, cooler_controller_id, eller andra strukturella inställningar.

## Parametrar du kan ändra (i fermentation_learnings per controller):
- stall_boost_degrees: Hur stor boost vid stall. MAX ÄNDRING: ±1.0 per audit. Range: 0.5-6.0.
- cooler_margin:{bucket}: Marginal för glykolkylaren per temperatur-bucket (cold/cool/warm/hot). Range: 0.5-8.0.
- hold_margin:{bucket}:{load}: Optimal marginal under hold-steg. Range: 0.5-8.0. MAX ÄNDRING: ±1.0 per audit.
- ramp_margin:{bucket}:{load}: Optimal marginal under ramp-steg. Range: 0.5-8.0. MAX ÄNDRING: ±1.0 per audit.
- duty_cycle:{bucket}: Inlärd duty cycle (%) per temperaturzon. Range: 5-95. MAX ÄNDRING: ±10 per audit.
- cooling_rate:{bucket}:{load}: Inlärd kylhastighet (°C/min). Range: 0.01-2.0. MAX ÄNDRING: ±0.1 per audit.
- warming_rate:{bucket}: Passiv uppvärmningshastighet (°C/h) per temperaturzon. Justeras om prediktiv styrning gör felbedömningar. Range: 0.01-10.0. MAX ÄNDRING: ±0.5 per audit.

## Svar-format (MÅSTE vara valid JSON):
{
  "summary": "1-2 meningar om systemets övergripande status",
  "health_score": 1-10,
  "anomalies": [{"type": "...", "severity": "low|medium|high", "description": "..."}],
  "parameter_changes": [{"table": "auto_cooling_settings|fermentation_learnings", "controller_id": "...|null", "parameter": "...", "old_value": 0, "new_value": 0, "reason": "..."}],
  "recommendations": ["Textrekommendation som inte kan auto-åtgärdas"]
}`;

    const dataPayload = {
      current_time: new Date().toISOString(),
      settings: settings ? {
        enabled: settings.enabled,
        pill_compensation_enabled: settings.pill_compensation_enabled,
        pill_compensation_damping: settings.pill_compensation_damping,
        pill_compensation_rate_limit: settings.pill_compensation_rate_limit,
        pill_compensation_max_compensation: settings.pill_compensation_max_compensation,
        pill_compensation_min_scale: settings.pill_compensation_min_scale,
        pill_compensation_emergency_threshold: settings.pill_compensation_emergency_threshold,
        auto_boost_enabled: settings.auto_boost_enabled,
        auto_boost_degrees: settings.auto_boost_degrees,
        stall_rate_threshold: settings.stall_rate_threshold,
        stall_min_attenuation: settings.stall_min_attenuation,
        stall_max_attenuation: settings.stall_max_attenuation,
        delta_alert_threshold: settings.delta_alert_threshold,
        temp_reduction_degrees: settings.temp_reduction_degrees,
        max_diff_from_lowest: settings.max_diff_from_lowest,
        overshoot_prevention_enabled: settings.overshoot_prevention_enabled,
        overshoot_pill_threshold: settings.overshoot_pill_threshold,
        overshoot_delta_threshold: settings.overshoot_delta_threshold,
        smart_relay_enabled: settings.smart_relay_enabled,
        smart_relay_min_hysteresis: settings.smart_relay_min_hysteresis,
        smart_relay_cooling_only_below: settings.smart_relay_cooling_only_below,
        smart_relay_heating_only_above: settings.smart_relay_heating_only_above,
        smart_relay_tighten_after_minutes: settings.smart_relay_tighten_after_minutes,
      } : null,
      controllers: (controllers || [])
        .filter((c: any) => c.cooling_enabled || c.heating_enabled)
        .map((c: any) => {
          // Find fermentation metrics for this controller via running sessions (session has brew_id)
          const session = (runningSessions || []).find((s: any) => s.controller_id === c.controller_id);
          const metrics = session?.brew_id ? (fermentationMetrics || []).find((m: any) => m.brew_id === session.brew_id) : null;
          // Also try matching via brew_readings.linked_controller_id
          const directMetrics = !metrics ? (fermentationMetrics || []).find((m: any) => {
            return (activeBrews || []).some((b: any) => b.id === m.brew_id && b.linked_controller_id === c.controller_id);
          }) : metrics;
          const fm = metrics || directMetrics;
          const sessionCtx = sessionProfileMap.get(c.controller_id);
          return {
            id: c.controller_id,
            name: sanitize(c.name),
            current_temp: c.current_temp,
            target_temp: c.target_temp,
            pill_temp: c.pill_temp,
            delta: c.pill_temp != null && c.current_temp != null ? +(c.pill_temp - c.current_temp).toFixed(2) : null,
            cooling: c.cooling_enabled,
            heating: c.heating_enabled,
            is_cooler: c.is_glycol_cooler,
            last_update: c.last_update,
            fermentation_phase: fm ? sanitize(fm.fermentation_phase, 30) : null,
            activity_score: fm?.activity_score ?? null,
            sg_rate_per_hour: fm?.sg_rate_per_hour ?? null,
            ready_to_crash: fm?.ready_to_crash ?? null,
            active_step_type: sessionCtx?.active_step_type ?? null,
            profile_name: sessionCtx ? sanitize(sessionCtx.profile_name, 40) : null,
            step_target_temp: sessionCtx?.step_target_temp ?? null,
          };
        }),
      running_sessions: (runningSessions || []).length,
      learned_parameters: (learnings || []).map((l: any) => ({
        controller_id: l.controller_id,
        parameter_name: sanitize(l.parameter_name, 50),
        learned_value: l.learned_value,
        sample_count: l.sample_count,
      })),
      pid_baselines: (learnedComp || []).map((c: any) => ({
        controller_id: c.controller_id,
        bucket: c.delta_bucket,
        mode: c.mode,
        step_type: c.step_type,
        correction: c.learned_pi_correction,
        integral: c.accumulated_integral,
        convergence: c.convergence_count,
        avg_error: c.latest_avg_error,
      })),
      recent_decision_summary: {
        total_logs: (decisionLogs || []).length,
        adjustments_made: (decisionLogs || []).filter((d: any) => d.adjustment_made).length,
        avg_duration_ms: (decisionLogs || []).length > 0
          ? Math.round((decisionLogs || []).reduce((sum: number, d: any) => sum + d.duration_ms, 0) / decisionLogs!.length)
          : 0,
      },
      recent_adjustments: (recentAdjustments || []).slice(0, 20).map((a: any) => ({
        controller: sanitize(a.cooler_controller_name),
        from: a.old_target_temp,
        to: a.new_target_temp,
        original: a.original_target_temp,
        reason: sanitize(a.reason?.substring(0, 100) ?? ''),
        at: a.created_at,
      })),
      boost_outcomes: (boostOutcomes || []).slice(0, 20).map((b: any) => ({
        controller_id: b.controller_id,
        boost_degrees: b.boost_degrees,
        sg_rate_before: b.sg_rate_before,
        sg_rate_after: b.sg_rate_after,
        outcome: sanitize(b.outcome, 30),
        created_at: b.created_at,
      })),
      delta_trend: summarizeDeltaTrend(deltaHistory || []),
    };

    const userPrompt = `Analysera detta bryggeri-automatiseringssystem och gör nödvändiga parameterändringar:

${JSON.stringify(dataPayload, null, 2)}

Svara ENBART med JSON (inget annat).`;

    console.log(`📊 Data collected: ${(controllers || []).length} controllers, ${(decisionLogs || []).length} decision logs, ${(learnings || []).length} learned params`);

    // ========================================
    // CALL AI
    // ========================================
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(30000), // 30s timeout to prevent hanging
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error(`AI gateway error: ${aiResponse.status} ${errText}`);
      throw new Error(`AI gateway error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content ?? '';
    console.log('🤖 AI response received, parsing...');

    // Parse JSON from AI response (handle markdown code blocks)
    let analysis: any;
    try {
      const jsonMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, rawContent];
      analysis = JSON.parse(jsonMatch[1]!.trim());
    } catch (parseErr) {
      console.error('Failed to parse AI response:', rawContent.substring(0, 500));
      analysis = {
        summary: 'Kunde inte tolka AI-svaret',
        health_score: 5,
        anomalies: [],
        parameter_changes: [],
        recommendations: [rawContent.substring(0, 200)],
      };
    }

    // ========================================
    // SCHEMA VALIDATION: Sanitize AI response structure
    // ========================================
    analysis = validateAnalysisSchema(analysis);

    // ========================================
    // APPLY PARAMETER CHANGES
    // ========================================
    const appliedChanges: any[] = [];
    const MAX_CHANGES_PER_AUDIT = 4; // Hard cap: max 4 parameter changes per cycle

    // Safety limits: max allowed change per parameter per audit cycle
    const MAX_STEP: Record<string, number> = {
      pill_compensation_damping: 0.1,
      pill_compensation_rate_limit: 0.1,
      pill_compensation_max_compensation: 0.5,
      pill_compensation_min_scale: 0.05,
      pill_compensation_emergency_threshold: 0.5,
      overshoot_pill_threshold: 0.1,
      overshoot_delta_threshold: 0.5,
      delta_alert_threshold: 0.5,
      stall_rate_threshold: 0.0005,
      auto_boost_degrees: 0.5,
      stall_min_attenuation: 5,
      stall_max_attenuation: 5,
      temp_reduction_degrees: 1.0,
      max_diff_from_lowest: 1.0,
      smart_relay_min_hysteresis: 0.1,
      smart_relay_cooling_only_below: 1.0,
      smart_relay_heating_only_above: 1.0,
      smart_relay_tighten_after_minutes: 5,
      stall_boost_degrees: 1.0,
      'cooler_margin:cold': 1.0,
      'cooler_margin:cool': 1.0,
      'cooler_margin:warm': 1.0,
      'cooler_margin:hot': 1.0,
      thermal_rate: 0.05,
      glycol_cooler_rate: 0.1,
    };

    // Absolute bounds per parameter
    const BOUNDS: Record<string, [number, number]> = {
      pill_compensation_damping: [0.1, 0.9],
      pill_compensation_rate_limit: [0.1, 1.0],
      pill_compensation_max_compensation: [1.0, 8.0],
      pill_compensation_min_scale: [0.05, 0.5],
      pill_compensation_emergency_threshold: [1.0, 5.0],
      overshoot_pill_threshold: [0.1, 1.0],
      overshoot_delta_threshold: [0.5, 5.0],
      delta_alert_threshold: [0.5, 5.0],
      stall_rate_threshold: [0.0005, 0.005],
      auto_boost_degrees: [0.5, 4.0],
      stall_min_attenuation: [5, 30],
      stall_max_attenuation: [70, 95],
      temp_reduction_degrees: [1.0, 10.0],
      max_diff_from_lowest: [3.0, 15.0],
      stall_boost_degrees: [0.5, 6.0],
      'cooler_margin:cold': [0.5, 8.0],
      'cooler_margin:cool': [0.5, 8.0],
      'cooler_margin:warm': [0.5, 8.0],
      'cooler_margin:hot': [0.5, 8.0],
      thermal_rate: [0.01, 2.0],
      glycol_cooler_rate: [0.01, 5.0],
    };

    // Whitelist for fermentation_learnings parameter_name (exact or prefix match)
    const VALID_LEARNING_EXACT = new Set([
      'stall_boost_degrees',
      'cooler_margin:cold', 'cooler_margin:cool', 'cooler_margin:warm', 'cooler_margin:hot',
      'thermal_rate', 'glycol_cooler_rate',
    ]);
    const VALID_LEARNING_PREFIXES = [
      'hold_margin:', 'ramp_margin:', 'duty_cycle:', 'cooling_rate:',
    ];
    function isValidLearningParam(param: string): boolean {
      if (VALID_LEARNING_EXACT.has(param)) return true;
      return VALID_LEARNING_PREFIXES.some(p => param.startsWith(p));
    }

    // Dynamic bounds/step for prefix-matched learning params
    function getLearningBounds(param: string): [number, number] | null {
      if (param.startsWith('hold_margin:') || param.startsWith('ramp_margin:')) return [0.5, 8.0];
      if (param.startsWith('duty_cycle:')) return [5, 95];
      if (param.startsWith('cooling_rate:')) return [0.01, 2.0];
      return BOUNDS[param] ?? null;
    }
    function getLearningMaxStep(param: string): number | null {
      if (param.startsWith('hold_margin:') || param.startsWith('ramp_margin:')) return 1.0;
      if (param.startsWith('duty_cycle:')) return 10;
      if (param.startsWith('cooling_rate:')) return 0.1;
      return MAX_STEP[param] ?? null;
    }

    // Valid settings params (single source)
    const VALID_SETTINGS_PARAMS = [
      'pill_compensation_damping', 'pill_compensation_rate_limit',
      'pill_compensation_max_compensation', 'pill_compensation_min_scale',
      'pill_compensation_emergency_threshold',
      'overshoot_pill_threshold', 'overshoot_delta_threshold',
      'delta_alert_threshold', 'stall_rate_threshold',
      'auto_boost_degrees', 'stall_min_attenuation', 'stall_max_attenuation',
      'temp_reduction_degrees', 'max_diff_from_lowest',
    ];

    // Helper: get the REAL current value from the database, not AI's claimed old_value
    function getActualSettingsValue(param: string): number | null {
      if (!settings) return null;
      return (settings as any)[param] ?? null;
    }

    if (analysis.parameter_changes && Array.isArray(analysis.parameter_changes)) {
      for (const change of analysis.parameter_changes) {
        // Hard cap on total changes per audit
        if (appliedChanges.length >= MAX_CHANGES_PER_AUDIT) {
          console.log(`🛑 Max changes per audit reached (${MAX_CHANGES_PER_AUDIT}), skipping remaining`);
          break;
        }

        try {
          // Reject changes with non-numeric new_value
          if (typeof change.new_value !== 'number' || !isFinite(change.new_value)) {
            console.log(`⚠️ Skipping non-numeric new_value for ${change.parameter}: ${change.new_value}`);
            continue;
          }

          const isLearning = change.table === 'fermentation_learnings';
          const maxStep = isLearning ? getLearningMaxStep(change.parameter) : MAX_STEP[change.parameter];
          const bounds = isLearning ? getLearningBounds(change.parameter) : BOUNDS[change.parameter];

          // CRITICAL: Use ACTUAL database value, not AI-provided old_value
          let actualOldValue: number | null = null;

          if (change.table === 'auto_cooling_settings') {
            actualOldValue = getActualSettingsValue(change.parameter);
          } else if (change.table === 'fermentation_learnings') {
            const existing = (learnings || []).find(
              (l: any) => l.controller_id === change.controller_id && l.parameter_name === change.parameter
            );
            actualOldValue = existing?.learned_value ?? null;
          }

          // Log if AI's old_value doesn't match reality
          if (actualOldValue != null && change.old_value != null && Math.abs(actualOldValue - change.old_value) > 0.001) {
            console.log(`⚠️ AI hallucinated old_value for ${change.parameter}: claimed ${change.old_value}, actual ${actualOldValue}`);
          }

          // Safety: clamp to max step size (using ACTUAL old value)
          if (maxStep != null && actualOldValue != null) {
            const delta = change.new_value - actualOldValue;
            if (Math.abs(delta) > maxStep) {
              const clampedNew = actualOldValue + Math.sign(delta) * maxStep;
              console.log(`⚠️ Safety clamp: ${change.parameter} wanted ${actualOldValue}→${change.new_value}, clamped to ${clampedNew.toFixed(4)} (max step ±${maxStep})`);
              change.new_value = parseFloat(clampedNew.toFixed(4));
            }
          }

          // Safety: clamp to absolute bounds
          if (bounds) {
            change.new_value = Math.max(bounds[0], Math.min(bounds[1], change.new_value));
          }

          // Skip no-op changes (against actual value)
          const effectiveOld = actualOldValue ?? change.old_value;
          if (effectiveOld != null && Math.abs(change.new_value - effectiveOld) < 0.0001) {
            console.log(`⏭️ Skipping no-op change for ${change.parameter}`);
            continue;
          }

          // Record actual old value for audit log
          change._actual_old_value = actualOldValue;

          if (change.table === 'auto_cooling_settings') {
            if (!settings) {
              console.log(`⚠️ Skipping settings change: no settings row found`);
              continue;
            }
            if (!VALID_SETTINGS_PARAMS.includes(change.parameter)) {
              console.log(`⚠️ Skipping invalid settings parameter: ${change.parameter}`);
              continue;
            }
            const { error } = await supabase.from('auto_cooling_settings')
              .update({ [change.parameter]: change.new_value, updated_at: new Date().toISOString() })
              .eq('id', settings.id);
            if (!error) {
              appliedChanges.push(change);
              console.log(`✅ Updated ${change.parameter}: ${actualOldValue} → ${change.new_value} (${change.reason})`);
            } else {
              console.error(`❌ Failed to update ${change.parameter}:`, error);
            }
          } else if (change.table === 'fermentation_learnings' && change.controller_id) {
            // Validate parameter name against whitelist
            if (!isValidLearningParam(change.parameter)) {
              console.log(`⚠️ Skipping invalid learning parameter: ${change.parameter}`);
              continue;
            }

            // Validate controller_id actually exists
            const controllerExists = (controllers || []).some(
              (c: any) => c.controller_id === change.controller_id
            );
            if (!controllerExists) {
              console.log(`⚠️ Skipping change for unknown controller_id: ${change.controller_id}`);
              continue;
            }

            // Fetch current record to preserve sample_count
            const { data: existing } = await supabase.from('fermentation_learnings')
              .select('sample_count')
              .eq('controller_id', change.controller_id)
              .eq('parameter_name', change.parameter)
              .maybeSingle();

            const currentSampleCount = existing?.sample_count ?? 0;

            const { error } = await supabase.from('fermentation_learnings').upsert({
              controller_id: change.controller_id,
              parameter_name: change.parameter,
              learned_value: change.new_value,
              sample_count: currentSampleCount, // preserve existing count
              last_updated_at: new Date().toISOString(),
            }, { onConflict: 'controller_id,parameter_name' });
            if (!error) {
              appliedChanges.push(change);
              console.log(`✅ Updated learning ${change.parameter} for ${change.controller_id}: ${actualOldValue} → ${change.new_value}`);
            } else {
              console.error(`❌ Failed to update learning:`, error);
            }
          } else {
            console.log(`⚠️ Skipping change with unknown table: ${change.table}`);
          }
        } catch (e) {
          console.error(`Error applying change:`, e);
        }
      }
    }

    // ========================================
    // SAVE AUDIT LOG
    // ========================================
    const duration = Date.now() - startTime;
    await supabase.from('ai_audit_log').insert({
      duration_ms: duration,
      model: 'google/gemini-3-flash-preview',
      prompt_summary: `${(controllers || []).length} controllers, ${(decisionLogs || []).length} logs, ${(learnings || []).length} params`,
      analysis: analysis.summary || 'No summary',
      actions_taken: appliedChanges,
      parameters_changed: analysis.parameter_changes || [],
      anomalies_detected: analysis.anomalies || [],
      recommendations: analysis.recommendations || [],
    });

    console.log(`🤖 AI audit complete in ${duration}ms: health=${analysis.health_score}/10, changes=${appliedChanges.length}, anomalies=${(analysis.anomalies || []).length}`);

    return new Response(JSON.stringify({
      ok: true,
      duration_ms: duration,
      health_score: analysis.health_score,
      summary: analysis.summary,
      changes_applied: appliedChanges.length,
      anomalies: (analysis.anomalies || []).length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error('AI audit error:', error);

    // Log failure
    await supabase.from('ai_audit_log').insert({
      duration_ms: duration,
      model: 'google/gemini-3-flash-preview',
      analysis: `Error: ${error instanceof Error ? error.message : String(error)}`,
      actions_taken: [],
      parameters_changed: [],
      anomalies_detected: [],
      recommendations: [],
    });

    return new Response(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

/** Strip control characters and limit length to prevent prompt injection */
function sanitize(input: string | null | undefined, maxLen = 80): string {
  if (!input) return '';
  // Remove control chars, newlines, and common injection patterns
  return input
    .replace(/[\x00-\x1f\x7f]/g, '') // control chars
    .replace(/\n|\r/g, ' ')          // newlines
    .substring(0, maxLen)
    .trim();
}

/** Validate and sanitize the AI response schema to prevent malformed data */
function validateAnalysisSchema(raw: any): {
  summary: string;
  health_score: number;
  anomalies: any[];
  parameter_changes: any[];
  recommendations: string[];
} {
  const safe = {
    summary: typeof raw?.summary === 'string' ? raw.summary.substring(0, 500) : 'No summary',
    health_score: typeof raw?.health_score === 'number' && raw.health_score >= 1 && raw.health_score <= 10
      ? Math.round(raw.health_score)
      : 5,
    anomalies: Array.isArray(raw?.anomalies) ? raw.anomalies.filter((a: any) =>
      typeof a?.type === 'string' &&
      typeof a?.description === 'string' &&
      ['low', 'medium', 'high'].includes(a?.severity)
    ).slice(0, 20) : [],
    parameter_changes: Array.isArray(raw?.parameter_changes) ? raw.parameter_changes.filter((c: any) =>
      typeof c?.table === 'string' &&
      typeof c?.parameter === 'string' &&
      typeof c?.new_value === 'number' &&
      typeof c?.reason === 'string' &&
      ['auto_cooling_settings', 'fermentation_learnings'].includes(c.table)
    ).slice(0, 10) : [],
    recommendations: Array.isArray(raw?.recommendations) ? raw.recommendations
      .filter((r: any) => typeof r === 'string')
      .map((r: string) => r.substring(0, 300))
      .slice(0, 10) : [],
  };

  const droppedChanges = (Array.isArray(raw?.parameter_changes) ? raw.parameter_changes.length : 0) - safe.parameter_changes.length;
  if (droppedChanges > 0) {
    console.log(`⚠️ Schema validation dropped ${droppedChanges} malformed parameter_changes`);
  }

  return safe;
}

/** Summarize delta trends per controller */
function summarizeDeltaTrend(deltaHistory: any[]): Record<string, { avg_delta: number; trend: string; samples: number }> {
  const byController = new Map<string, number[]>();
  for (const d of deltaHistory) {
    const list = byController.get(d.controller_id) || [];
    list.push(parseFloat(String(d.delta)));
    byController.set(d.controller_id, list);
  }

  const result: Record<string, any> = {};
  for (const [cId, deltas] of byController) {
    const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const mid = Math.floor(deltas.length / 2);
    const recentAvg = deltas.slice(0, mid).reduce((a, b) => a + b, 0) / (mid || 1);
    const olderAvg = deltas.slice(mid).reduce((a, b) => a + b, 0) / ((deltas.length - mid) || 1);
    const trend = Math.abs(recentAvg - olderAvg) < 0.2 ? 'stable' : recentAvg > olderAvg ? 'increasing' : 'decreasing';
    result[cId] = { avg_delta: +avg.toFixed(2), trend, samples: deltas.length };
  }
  return result;
}
