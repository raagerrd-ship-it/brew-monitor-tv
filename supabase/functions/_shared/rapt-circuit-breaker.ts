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

type SupabaseClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any
}

export interface CircuitState {
  open: boolean
  openUntilMs: number
  failStreak: number
}

/** Batch-hämta circuit-state för en lista controllers. Returnerar Set med öppna IDs. */
export async function getOpenCircuits(
  supabase: SupabaseClient,
  controllerIds: string[],
): Promise<Set<string>> {
  if (controllerIds.length === 0) return new Set()
  const { data } = await supabase
    .from('fermentation_learnings')
    .select('controller_id, learned_value')
    .in('controller_id', controllerIds)
    .eq('parameter_name', PARAM_UNTIL)
  const now = Date.now()
  const open = new Set<string>()
  for (const row of (data ?? []) as Array<{ controller_id: string; learned_value: number }>) {
    if (row.learned_value > now) open.add(row.controller_id)
  }
  return open
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
    .in('parameter_name', [PARAM_STREAK, PARAM_UNTIL])
  let streak = 0
  let until = 0
  for (const row of (data ?? []) as Array<{ parameter_name: string; learned_value: number }>) {
    if (row.parameter_name === PARAM_STREAK) streak = row.learned_value ?? 0
    if (row.parameter_name === PARAM_UNTIL) until = row.learned_value ?? 0
  }
  return { open: until > Date.now(), openUntilMs: until, failStreak: streak }
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
  const newStreak = current.failStreak + 1
  let openUntilMs = current.openUntilMs
  let justOpened = false
  if (newStreak >= FAIL_THRESHOLD && !current.open) {
    openUntilMs = Date.now() + COOLDOWN_MS
    justOpened = true
  }
  await Promise.all([
    upsertParam(supabase, controllerId, PARAM_STREAK, newStreak),
    upsertParam(supabase, controllerId, PARAM_UNTIL, openUntilMs),
  ])
  return { newStreak, justOpened, openUntilMs }
}

export const CIRCUIT_BREAKER_CONFIG = {
  FAIL_THRESHOLD,
  COOLDOWN_MS,
}