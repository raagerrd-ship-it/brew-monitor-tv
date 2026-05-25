// RAPT write circuit-breaker.
//
// Skyddar mot rate-limit storms när en specifik controller slutar svara på
// SetTargetTemperature (timeouts/429). Efter N konsekutiva misslyckade writes
// öppnas kretsen i COOLDOWN_MS — under tiden hoppar vi över PWM-bursts och
// skjuter upp pending reverts så att andra controllers inte drabbas av
// RAPT-quota-blockering.
//
// State lagras i fermentation_learnings (slipper migration):
//   parameter_name = 'rapt_write_fail_streak'          → konsekutiva fel
//   parameter_name = 'rapt_circuit_open_until_ms'      → ms-timestamp

const FAIL_THRESHOLD = 3
const COOLDOWN_MS = 10 * 60 * 1000 // 10 min

const PARAM_STREAK = 'rapt_write_fail_streak'
const PARAM_UNTIL = 'rapt_circuit_open_until_ms'
const PARAM_PROBE = 'rapt_circuit_probe_pending'
const STREAK_CAP = FAIL_THRESHOLD + 2

type SupabaseClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any
}

export interface CircuitState {
  open: boolean
  openUntilMs: number
  failStreak: number
  probePending: boolean
}

/** Batch-hämta circuit-state för en lista controllers. Returnerar Set med öppna IDs.
 *  Sido-effekt: när cooldown precis löpt ut sätts probe=1 automatiskt så nästa
 *  PWM-OFF får agera "probe" innan vi släpper full trafik igen. */
export async function getOpenCircuits(
  supabase: SupabaseClient,
  controllerIds: string[],
): Promise<Set<string>> {
  if (controllerIds.length === 0) return new Set()
  const { data } = await supabase
    .from('fermentation_learnings')
    .select('controller_id, parameter_name, learned_value')
    .in('controller_id', controllerIds)
    .in('parameter_name', [PARAM_UNTIL, PARAM_PROBE])
  const now = Date.now()
  const open = new Set<string>()
  const untilByCtrl = new Map<string, number>()
  const probeByCtrl = new Map<string, number>()
  for (const row of (data ?? []) as Array<{ controller_id: string; parameter_name: string; learned_value: number }>) {
    if (row.parameter_name === PARAM_UNTIL) untilByCtrl.set(row.controller_id, row.learned_value ?? 0)
    else if (row.parameter_name === PARAM_PROBE) probeByCtrl.set(row.controller_id, row.learned_value ?? 0)
  }
  for (const [ctrl, until] of untilByCtrl.entries()) {
    if (until > now) {
      open.add(ctrl)
    } else if (until > 0 && (probeByCtrl.get(ctrl) ?? 0) === 0) {
      // Cooldown precis löpt ut — arm en probe så vi inte släpper full flod direkt.
      await upsertParam(supabase, ctrl, PARAM_PROBE, 1)
    }
  }
  // Controllers med aktiv probe räknas också som "öppna" mot PID-bursts —
  // bara PWM-OFF (revert) får passera, och bara EN åt gången.
  for (const [ctrl, probe] of probeByCtrl.entries()) {
    if (probe > 0) open.add(ctrl)
  }
  return open
}

/** Är en probe armad för denna controller? (true = revert får passera som test). */
export async function isProbePending(
  supabase: SupabaseClient,
  controllerId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('fermentation_learnings')
    .select('learned_value')
    .eq('controller_id', controllerId)
    .eq('parameter_name', PARAM_PROBE)
    .maybeSingle()
  return (data?.learned_value ?? 0) > 0
}

/** Konsumera probe atomiskt — returnerar true om probe var armad och nu nollställs. */
export async function consumeProbe(
  supabase: SupabaseClient,
  controllerId: string,
): Promise<boolean> {
  const pending = await isProbePending(supabase, controllerId)
  if (!pending) return false
  await upsertParam(supabase, controllerId, PARAM_PROBE, 0)
  return true
}

/** Hämta circuit-state för en enskild controller. */
export async function getCircuitState(
  supabase: SupabaseClient,
  controllerId: string,
): Promise<CircuitState> {
  const { data } = await supabase
    .from('fermentation_learnings')
    .select('parameter_name, learned_value')
    .eq('controller_id', controllerId)
    .in('parameter_name', [PARAM_STREAK, PARAM_UNTIL, PARAM_PROBE])
  let streak = 0
  let until = 0
  let probe = 0
  for (const row of (data ?? []) as Array<{ parameter_name: string; learned_value: number }>) {
    if (row.parameter_name === PARAM_STREAK) streak = row.learned_value ?? 0
    if (row.parameter_name === PARAM_UNTIL) until = row.learned_value ?? 0
    if (row.parameter_name === PARAM_PROBE) probe = row.learned_value ?? 0
  }
  return { open: until > Date.now(), openUntilMs: until, failStreak: streak, probePending: probe > 0 }
}

async function upsertParam(
  supabase: SupabaseClient,
  controllerId: string,
  paramName: string,
  value: number,
): Promise<void> {
  await supabase.from('fermentation_learnings').upsert(
    {
      controller_id: controllerId,
      parameter_name: paramName,
      learned_value: value,
      sample_count: 1,
      last_updated_at: new Date().toISOString(),
    },
    { onConflict: 'controller_id,parameter_name' },
  )
}

/** Anropa efter en lyckad RAPT-write — nollställer fail-streak och stänger kretsen. */
export async function recordWriteSuccess(
  supabase: SupabaseClient,
  controllerId: string,
): Promise<void> {
  await Promise.all([
    upsertParam(supabase, controllerId, PARAM_STREAK, 0),
    upsertParam(supabase, controllerId, PARAM_UNTIL, 0),
    upsertParam(supabase, controllerId, PARAM_PROBE, 0),
  ])
}

/**
 * Anropa efter en misslyckad RAPT-write. Returnerar nya state — om kretsen
 * just öppnades är `justOpened=true` så callern kan logga det tydligt.
 */
export async function recordWriteFailure(
  supabase: SupabaseClient,
  controllerId: string,
): Promise<{ newStreak: number; justOpened: boolean; openUntilMs: number }> {
  const current = await getCircuitState(supabase, controllerId)
  const newStreak = Math.min(current.failStreak + 1, STREAK_CAP)
  let openUntilMs = current.openUntilMs
  let justOpened = false
  if (newStreak >= FAIL_THRESHOLD && !current.open) {
    openUntilMs = Date.now() + COOLDOWN_MS
    justOpened = true
  }
  await Promise.all([
    upsertParam(supabase, controllerId, PARAM_STREAK, newStreak),
    upsertParam(supabase, controllerId, PARAM_UNTIL, openUntilMs),
    // Vid fel under probe-fas → nollställ probe (kommer armas igen vid nästa cooldown-utgång).
    upsertParam(supabase, controllerId, PARAM_PROBE, 0),
  ])
  // Skicka push första gången kretsen öppnas (dedupe 1 h på pending_notifications).
  if (justOpened) {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      const { data: recent } = await supabase
        .from('pending_notifications')
        .select('id')
        .eq('type', 'rapt_controller_dead')
        .eq('controller_id', controllerId)
        .gte('created_at', oneHourAgo)
        .limit(1)
      if (!recent || (recent as unknown[]).length === 0) {
        // Slå upp namn för läsbar titel
        const { data: ctrl } = await supabase
          .from('rapt_temp_controllers')
          .select('name')
          .eq('controller_id', controllerId)
          .maybeSingle()
        const name = (ctrl as { name?: string } | null)?.name ?? controllerId
        await supabase.from('pending_notifications').insert({
          type: 'rapt_controller_dead',
          title: 'RAPT-controller svarar inte',
          body: `${name}: ${newStreak} konsekutiva fel mot RAPT — PWM pausad i 10 min.`,
          controller_id: controllerId,
        })
      }
    } catch (notifErr) {
      console.error(`circuit-breaker notify fail: ${notifErr}`)
    }
  }
  return { newStreak, justOpened, openUntilMs }
}

export const CIRCUIT_BREAKER_CONFIG = {
  FAIL_THRESHOLD,
  COOLDOWN_MS,
  STREAK_CAP,
}