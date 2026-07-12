import { getTempBucket, updateLearnedParam } from './learning-utils.ts'

// ============================================================
// ΔT-normalisering (kontinuerlig, inte hinkad)
//
// Lagrade `feedforward_duty` och `process_gain` normaliseras till referens-ΔT
// (10°C) mellan target_temp och glykol-temp. Skalas vid läsning/skrivning så
// samma EMA-serie förblir fysikaliskt konsistent oavsett glykolens temperatur.
//
// Newtons avkylning: Q ∝ ΔT. Vid dubbelt så stor ΔT ger samma duty dubbelt så
// stark kylning — utan denna skalning skulle en enda EMA över blandade
// ΔT-lägen ge fel svar i båda ändarna.
//
// Använder `target_temp − glycol_temp` (inte `actual_temp`): ff mäts per
// definition vid jämvikt (actual≈target) så target ÄR rätt delta där, och
// dessutom en renare signal utan actual_temps EMA-fördröjning och brus.
// ============================================================
const DELTA_T_REF = 10.0
const DELTA_T_MIN = 3.0

function computeDeltaT(target: number, glycolTemp: number | null | undefined): number | null {
  if (glycolTemp == null || !Number.isFinite(glycolTemp)) return null
  if (!Number.isFinite(target)) return null
  return Math.max(DELTA_T_MIN, target - glycolTemp)
}

// ============================================================
// PID Control & Thermal Learning (V6: feedforward + P + D)
//
// Designprinciper (dödtidsdominerad process: ~15 min probe-latens, 60L massa):
//
//   duty = feedforwardDuty + trimI + Kp·need − Kd·approachRate
//
//   • feedforwardDuty = lärd steady-state-duty (ambient_gain / cool_response,
//     se learnFeedforwardDuty). Detta ÄR biasen — duty kollapsar alltså inte
//     mot 0 nära mål, den landar på det verkliga behovet.
//   • Kp·need skalar duty med avstånd till mål (större fel → mer duty).
//   • Kd·approachRate bromsar när SSOT redan rör sig mot mål i god fart,
//     så vi inte bygger upp mer korrigering än vad som hinner verka innan
//     dödtiden (~15 min) slår igenom. Endast broms, aldrig acceleration.
//   • trimI är en långsam, litet begränsad (±10%) korrigering ovanpå
//     feedforward för residual bias — INTE huvudmekanismen.
//
// V5 hade separata mekanismer för hold/ramp/dither-zon/pre-cool/approach-
// freeze som la sig i vägen för varandra (se historik). Denna formel ersätter
// alla dem: samma lag oavsett stepType, duty följer alltid avstånd+trend,
// och trappar naturligt ner mot feedforward — ingen "planar ut vid 0 och
// måste knuffas tillbaka upp"-problematik som krävde hold-lock/trickle.
//
// SSOT Naming Convention:
//   actualTarget       = användarens önskemål (profile_target_temp)
//   actualTemp         = bulk-temp (kallaren bestämmer källan)
//   actualTempAgeMin   = minuter sedan SSOT senast uppdaterades
//   ctrlTarget         = nuvarande HW-mål (legacy)
//   ctrlTargetPid      = actualTarget (PID-output är duty)
//
// Persistent state lever i controller_learned_compensation:
//   accumulated_integral → trimI
//   sensor_anchor (JSONB) → V5PidState (SSOT-EMA + rate-window + min-off)
//
// State delas nu PER (controller, mode) — inte längre per step_type. Fysiken
// (termisk respons) ändras inte mellan hold/ramp, bara målet gör, och samma
// formel hanterar båda. Att bucketa state per step_type innebar att en
// hold→ramp→hold-övergång (t.ex. diacetylrast) kastade bort inlärd trim och
// rate-historik precis när kontinuitet behövdes som mest.
// ============================================================

/** Persistent PID-tillstånd mellan cykler (lagras i sensor_anchor JSONB). */
interface V5PidState {
  lastSsot?: number
  lastSsotAt?: string
  ssotSmoothed?: number       // EMA av SSOT — dämpar sensorjitter före PID
  ssotHistory?: Array<{ t: string; v: number }>  // rullande ~30min för D-termens windowed rate
  trimI?: number              // liten, begränsad bias-trim ovanpå feedforward
  lastDutyPct?: number
  lastZeroDutyAt?: string     // min-off-skydd (kylning)
  lastMode?: 'heating' | 'cooling'
  /** Rullande hold-fönster för direkt ssFloor-observation. Nollställs vid
   *  mode-flip, för stort fel, eller efter uppdatering. Se observeHoldSsFloor. */
  holdWindow?: { count: number; dutySum: number; mode: 'heating' | 'cooling'; firstTs: string }
}

// ── V5PidState schema ────────────────────────────────────────────────────
// Single source of truth for (a) what fields exist and (b) their runtime
// type, used to safely parse sensor_anchor JSONB back into V5PidState.
//
// The `satisfies Record<keyof V5PidState, ...>` below is load-bearing: if a
// field is added to V5PidState but not here (or vice versa), TypeScript
// fails to compile — this is what prevents a field from being silently
// dropped on the read path (we hit exactly that bug once already with a
// hand-written reconstruction; don't go back to one).
const V5_STATE_SCHEMA = {
  lastSsot: 'number',
  lastSsotAt: 'string',
  ssotSmoothed: 'number',
  ssotHistory: 'history',
  trimI: 'number',
  lastDutyPct: 'number',
  lastZeroDutyAt: 'string',
  lastMode: 'mode',
  holdWindow: 'holdWindow',
} as const satisfies Record<keyof V5PidState, 'number' | 'string' | 'boolean' | 'mode' | 'history' | 'holdWindow'>

/** Parse persisted sensor_anchor JSONB back into V5PidState, dropping any
 *  field whose runtime type doesn't match the schema (defends against
 *  corrupted/legacy JSON). */
function parseV5State(raw: unknown): V5PidState {
  if (!raw || typeof raw !== 'object') return {}
  const a = raw as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, kind] of Object.entries(V5_STATE_SCHEMA)) {
    const v = a[key]
    if (kind === 'mode') {
      if (v === 'heating' || v === 'cooling') out[key] = v
    } else if (kind === 'history') {
      if (Array.isArray(v)) {
        const arr = v
          .filter((e): e is { t: string; v: number } =>
            !!e && typeof e === 'object' &&
            typeof (e as any).t === 'string' && typeof (e as any).v === 'number')
        if (arr.length > 0) out[key] = arr
      }
    } else if (kind === 'holdWindow') {
      if (v && typeof v === 'object') {
        const w = v as any
        if (
          typeof w.count === 'number' && typeof w.dutySum === 'number' &&
          (w.mode === 'heating' || w.mode === 'cooling') &&
          typeof w.firstTs === 'string'
        ) out[key] = { count: w.count, dutySum: w.dutySum, mode: w.mode, firstTs: w.firstTs }
      }
    } else if (typeof v === kind) {
      out[key] = v
    }
  }
  return out as V5PidState
}

// ── Tuning constants ─────────────────────────────────────────────────────
// Kp/Kd are intentionally modest: feedforwardDuty already carries the
// steady-state load, so P only needs to cover the *transient* distance to
// target, and D only needs to trim the final approach — neither has to do
// the heavy lifting a bias-less PI needed before.
// Kd är i "timmar" (duty per °C/h), inte per-minut — matchar deriveGains
// (Kd = Kp × dödtid_i_timmar). 5.0 / 3.5 var tidigare kalibrerade mot en
// per-minut-rate; /60 här ger exakt samma verkliga bromsstyrka, bara i de
// enheter som räkningen nedan (approachRatePerHour) faktiskt använder.
const COOL = { Kp: 0.22, Kd: 5.0 / 60, Ki: 0.06 }
const HEAT = { Kp: 0.35, Kd: 3.5 / 60, Ki: 0.10 }
const DEAD_TIME_HOURS = 0.25   // ~15min probe-latens — τc för lambda-tuning av Kp/Kd (se deriveGains)
const TRIM_MAX = 0.10          // trimI clamp — small, bias-correction only
const D_MAX = 0.35             // cap on D-brake so a fast approach can't zero duty outright
const SLEW_PER_CYCLE = 0.05    // max ±5 procentenheter duty/cykel, gäller nu universellt (se computeDutyV5)
const STALE_FREEZE_MIN = 8     // SSOT > N min → frys trim/rate-beroende termer
const MIN_OFF_MIN = 5          // kylning: min tid mellan duty>0 efter en 0%-cykel (kompressor/glykol-skydd)
const TAU_MIN = 12.0           // EMA-tidskonstant — måste överstiga 5min sample-intervall + rymma ~15min probe-latens
const RATE_WINDOW_MIN = 20     // D-termens rate mäts över ~20min, inte enstaka cykel — matchar dödtiden, ignorerar PWM-dither-brus
const RATE_WINDOW_LOW = 12, RATE_WINDOW_HIGH = 28
const HISTORY_KEEP_MIN = 30    // hur länge ssotHistory-samples sparas

/** Persist PID state to controller_learned_compensation. */
async function persistPidState(
  supabase: any,
  controllerId: string, deltaBucket: string, mode: string,
  pTerm: number, trimI: number, avgError: number,
  dutyCycle: number, nextState: V5PidState,
  feedforwardDuty: number,
): Promise<void> {
  await supabase.from('controller_learned_compensation').upsert({
    controller_id: controllerId, delta_bucket: deltaBucket, mode, step_type: 'v6',
    latest_p_correction: pTerm, latest_i_correction: trimI,
    latest_d_damping: dutyCycle,
    latest_avg_error: avgError,
    accumulated_integral: trimI,
    sensor_anchor: nextState,
    // learned_pi_correction retained for dashboard/observability continuity —
    // now just mirrors the feedforward-learned duty rather than a separate
    // convergence-gated EMA (that whole mechanism is gone; feedforward via
    // learnFeedforwardDuty is the sole source of the learned steady-state duty).
    learned_pi_correction: feedforwardDuty,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'controller_id,delta_bucket,mode,step_type', ignoreDuplicates: false })
}

/** Läs senast uppmätt processförstärkning (°/h per 1% duty) — persisteras av
 *  learnFeedforwardDuty från samma verkliga historik som feedforward-dutyn,
 *  så den delar exakt samma 2h-cache/kvalitetsgrind (≥2 respons-samples).
 *  0 = ingen mätning ännu → deriveGains faller tillbaka på statiska defaults. */
async function getProcessGain(
  supabase: any, controllerId: string, mode: 'heating' | 'cooling',
  deltaT: number | null,
): Promise<number> {
  const { data } = await supabase
    .from('fermentation_learnings')
    .select('learned_value')
    .eq('controller_id', controllerId)
    .eq('parameter_name', `process_gain:${mode}`)
    .maybeSingle()
  if (!data) return 0
  const v = parseFloat(String(data.learned_value))
  if (!(Number.isFinite(v) && v > 0)) return 0
  // Denormalisera lagrat värde (normaliserat mot ΔT_ref) till effektiv gain
  // vid aktuell ΔT. Vid större ΔT → mer °C-förändring per %-duty (Q ∝ ΔT).
  // Endast cooling har fysikalisk mening att skala mot glykol-ΔT.
  if (mode !== 'cooling' || deltaT == null) return v
  return v * (deltaT / DELTA_T_REF)
}

/** Härled Kp/Kd från uppmätt processförstärkning istället för att låta dem
 *  vara en egen fri-löpande adaptiv loop (vilket är precis den typen av
 *  interagerande självjustering som orsakade instabilitet tidigare).
 *  Lambda/IMC-tuning: Kp = 1 / (gain × τc), τc satt till dödtiden (~15min)
 *  enligt gängse regel (τc ≥ dödtid). Kd = Kp × dödtid — anticipatory
 *  broms som ungefär matchar hur långt SSOT hinner röra sig innan nuvarande
 *  duty ens syns i mätningen.
 *  Klampad till [0.3×, 3×] av statiska defaults så en brusig tidig mätning
 *  inte ger orimliga gains — inte en fri parameter, bara en säkerhetsmarginal
 *  runt en deterministisk formel. */
function deriveGains(
  processGainPerPct: number,
  defaults: { Kp: number; Kd: number },
): { Kp: number; Kd: number; source: 'measured' | 'default' } {
  if (!(processGainPerPct > 0)) return { Kp: defaults.Kp, Kd: defaults.Kd, source: 'default' }
  const tauC = DEAD_TIME_HOURS
  let Kp = 1 / (processGainPerPct * 100 * tauC)
  Kp = Math.max(defaults.Kp * 0.3, Math.min(defaults.Kp * 3, Kp))
  const Kd = Kp * DEAD_TIME_HOURS
  return { Kp, Kd, source: 'measured' }
}


export async function calculateCompensatedTarget(
  supabase: any,
  controllerId: string,
  actualTarget: number,
  ctrlTarget: number,
  controllerName: string,
  mode: 'heating' | 'cooling' = 'cooling',
  stepType: string = 'unknown',
  actualTemp: number,
  isStaleData: boolean,
  coolingUtilization?: number | null,
  modeJustSwitched?: boolean,
  coolingPwmWindowMin: number = 8,
  actualTempAgeMin?: number | null,
  glycolTemp?: number | null,
): Promise<{ ctrlTargetPid: number; dutyCycle?: number; pCorrection?: number; iCorrection?: number; learnedBaseline?: number; deltaBucket?: string; convergenceCount?: number; constraints?: string[]; persistPromise?: Promise<void>; coolingPwmWindowMin?: number }> {
  const constraints: string[] = []
  const deltaBucket = 'low'
  void ctrlTarget
  void stepType   // no longer branches the control law — same formula for hold/ramp/crash

  // State is now keyed per (controller, mode) only — see header comment for why.
  const { data: learnedRow } = await supabase
    .from('controller_learned_compensation')
    .select('accumulated_integral, sensor_anchor')
    .eq('controller_id', controllerId)
    .eq('delta_bucket', deltaBucket)
    .eq('mode', mode)
    .eq('step_type', 'v6')
    .maybeSingle()

  let persistedTrimI = learnedRow ? parseFloat(String(learnedRow.accumulated_integral)) : 0
  if (!Number.isFinite(persistedTrimI) || Math.abs(persistedTrimI) > TRIM_MAX) persistedTrimI = 0
  const prevState: V5PidState = parseV5State(learnedRow?.sensor_anchor)

  // ΔT mellan aktuellt mål och glykol — driver kontinuerlig normalisering av
  // både feedforward_duty och process_gain. `null` = ingen glykol-data → fall
  // tillbaka på oskaladat värde (bakåtkompatibelt).
  const deltaT = mode === 'cooling' ? computeDeltaT(actualTarget, glycolTemp) : null

  // The learned steady-state duty — this is the primary signal now, not a floor.
  const feedforwardDuty = await learnFeedforwardDuty(supabase, controllerId, mode, deltaT).catch(() => 0)

  // Kp/Kd derived from measured process gain (see deriveGains) instead of a
  // second adaptive loop — falls back to static defaults until enough real
  // response samples exist.
  const processGainPerPct = await getProcessGain(supabase, controllerId, mode, deltaT).catch(() => 0)
  const gainDefaults = mode === 'cooling' ? COOL : HEAT
  const gains = deriveGains(processGainPerPct, gainDefaults)

  void isStaleData // SSOT är källan; staleness hanteras via actualTempAgeMin nedan
  const r = computeDutyV5({
    mode,
    actualTarget, actualTemp,
    feedforwardDuty: feedforwardDuty ?? 0,
    persistedTrimI,
    modeJustSwitched: !!modeJustSwitched,
    coolingUtilization: coolingUtilization ?? null,
    prevState,
    actualTempAgeMin: actualTempAgeMin ?? null,
    gains,
  })
  const dutyCycle = r.duty
  for (const c of r.constraints) constraints.push(c)

  const avgError = actualTarget - actualTemp
  const need = mode === 'cooling' ? -avgError : avgError

  // Loggens err/need är RÅ SSOT — pTerm beräknas internt på ssotFiltered
  // (EMA, τ=12min), en annan siffra. De två kan divergera rejält när EMA:n
  // fortfarande drar sig mot en äldre, varmare/kallare historik (t.ex. precis
  // efter en PWM-burst eller ett snabbt temperaturhopp) — utan att båda
  // visas explicit ser P-termen ut att inte stämma med den loggade need,
  // vilket kostade en hel felsökningsrunda att reda ut. Visa båda.
  const filteredAvgError = r.nextState.ssotSmoothed != null
    ? actualTarget - r.nextState.ssotSmoothed
    : avgError
  const needSmoothed = mode === 'cooling' ? -filteredAvgError : filteredAvgError

  console.log(`🎯 ${mode} ${controllerName}: err=${avgError.toFixed(2)}°(raw)/${filteredAvgError.toFixed(2)}°(ema), need=${need.toFixed(2)}°(raw)/${needSmoothed.toFixed(2)}°(ema, pTerm-input), ff=${(r.ff*100).toFixed(1)}%, P=${(r.p*100).toFixed(1)}%, D=${(r.d*100).toFixed(1)}%, trimI=${(r.trimI*100).toFixed(1)}%, gains=${gains.source}(Kp=${gains.Kp.toFixed(2)},Kd=${gains.Kd.toFixed(2)}), duty=${(dutyCycle*100).toFixed(0)}% [${constraints.join(',')}]`)

  const persistPromise = persistPidState(
    supabase, controllerId, deltaBucket, mode,
    r.p, r.trimI, filteredAvgError, dutyCycle, r.nextState,
    feedforwardDuty ?? 0,
  )

  return {
    ctrlTargetPid: Math.round(actualTarget * 10) / 10,
    dutyCycle,
    pCorrection: r.p,
    iCorrection: r.trimI,
    learnedBaseline: feedforwardDuty ?? 0,
    deltaBucket,
    convergenceCount: 0,   // vestigial field, no longer meaningful under V6
    constraints,
    persistPromise,
    coolingPwmWindowMin,
  }
}

// ============================================================
// V6: feedforward + P + D — pure function, no DB access
// ============================================================
function computeDutyV5(input: {
  mode: 'heating' | 'cooling'
  actualTarget: number
  actualTemp: number             // SSOT — enda temperatursignal
  feedforwardDuty: number        // lärd steady-state duty (0..1)
  persistedTrimI: number
  modeJustSwitched: boolean
  coolingUtilization: number | null
  prevState: V5PidState
  actualTempAgeMin?: number | null
  gains: { Kp: number; Kd: number; source: 'measured' | 'default' }   // se deriveGains
}): { duty: number; trimI: number; p: number; d: number; ff: number; constraints: string[]; nextState: V5PidState } {
  const constraints: string[] = []
  const isCooling = input.mode === 'cooling'
  const now = new Date().toISOString()
  const nowMs = Date.now()

  // ── dt & SSOT-smoothing (EMA, tau=12min: > 5min sample-cykel, täcker
  // ~15min probe-latens så vi inte reagerar på transient PWM-dither-brus). ──
  let dtMin = 5.0
  if (input.prevState.lastSsotAt) {
    const raw = (nowMs - new Date(input.prevState.lastSsotAt).getTime()) / 60000
    if (Number.isFinite(raw)) dtMin = Math.max(0.25, Math.min(5.0, raw))
  }
  const alpha = 1 - Math.exp(-dtMin / TAU_MIN)
  const prevSmoothed = input.prevState.ssotSmoothed
  const ssotFiltered = prevSmoothed != null
    ? prevSmoothed + alpha * (input.actualTemp - prevSmoothed)
    : input.actualTemp

  const avgError = input.actualTarget - ssotFiltered
  const need = isCooling ? -avgError : avgError   // >0 = aktuatorn ska jobba hårdare
  // Kp/Kd kommer från deriveGains (uppmätt processförstärkning eller statisk
  // fallback) — Ki är fortfarande en liten statisk trim, ingen anledning att
  // härleda den, den ska bara nudge:a bort residual bias, inte bära lasten.
  const Ki = (isCooling ? COOL : HEAT).Ki
  const K = { Kp: input.gains.Kp, Kd: input.gains.Kd, Ki }
  if (input.gains.source === 'measured') constraints.push(`gains-measured(Kp=${K.Kp.toFixed(2)},Kd=${K.Kd.toFixed(2)})`)

  const isStaleSsot = input.actualTempAgeMin != null && input.actualTempAgeMin > STALE_FREEZE_MIN
  if (isStaleSsot) constraints.push(`ssot-stale-freeze(${input.actualTempAgeMin!.toFixed(0)}m)`)

  // ── Windowed rate för D-termen: ~20min lookback istället för enstaka
  // cykel, så vi svarar på verklig termisk trend och inte PWM-dither/sensor-
  // brus. Faller tillbaka på cykel-raten om historiken är för kort (cold start). ──
  const history = input.prevState.ssotHistory ?? []
  let windowedRatePerMin: number | null = null
  {
    const candidates = history
      .map(e => ({ ageMin: (nowMs - new Date(e.t).getTime()) / 60000, v: e.v }))
      .filter(e => e.ageMin >= RATE_WINDOW_LOW && e.ageMin <= RATE_WINDOW_HIGH)
      .sort((a, b) => Math.abs(a.ageMin - RATE_WINDOW_MIN) - Math.abs(b.ageMin - RATE_WINDOW_MIN))
    if (candidates.length > 0) {
      const anchor = candidates[0]
      windowedRatePerMin = (ssotFiltered - anchor.v) / anchor.ageMin
    }
  }
  const cycleRatePerMin = prevSmoothed != null ? (ssotFiltered - prevSmoothed) / dtMin : 0
  const ratePerMin = windowedRatePerMin ?? cycleRatePerMin
  // approachRatePerMin ska vara >0 närhelst |need| krymper — dvs. både på
  // väg MOT mål (need>0, minskande) OCH på väg TILLBAKA från en
  // överskjutning (need<0, växande mot 0). d(need)/dt har motsatt tecken
  // beroende på vilken sida av mål vi är på, så vi flippar tecknet när
  // need redan är negativt (redan förbi mål) — annars bromsar D-termen
  // bara i EN riktning (in mot mål) och aldrig när vi seglar tillbaka från
  // en överskjutning, trots att samma dödtid gäller åt båda hållen.
  const dNeedDt = isCooling ? ratePerMin : -ratePerMin
  const approachRatePerMin = need >= 0 ? -dNeedDt : dNeedDt   // >0 = |need| krymper
  const approachRatePerHour = approachRatePerMin * 60   // Kd är kalibrerad i timmar, se COOL/HEAT-kommentar

  // ── D-term: broms proportionell mot approach-rate. Endast broms (aldrig
  // acceleration) — P-termen sköter redan hur mycket kraft felet kräver. ──
  const dBrake = (!isStaleSsot && approachRatePerHour > 0)
    ? Math.min(D_MAX, K.Kd * approachRatePerHour)
    : 0
  if (dBrake > 0) {
    constraints.push(`d-brake(${(dBrake*100).toFixed(1)}%,rate=${approachRatePerHour.toFixed(2)}°/h)`)
  }

  // ── P-term: duty skalar med avstånd till mål — ÅT BÅDA HÅLL. Positivt need
  // (fortfarande för varmt) höjer duty över feedforward; negativt need (redan
  // förbi mål) sänker duty UNDER feedforward så vi släpper av och låter
  // systemet glida tillbaka istället för att fortsätta kyla på ff-nivå rakt
  // igenom målet. (Total duty klampas till [0,1] längre ner — inte här.) ──
  const pTerm = K.Kp * need

  // ── Feedforward: lärd steady-state-duty. Detta ÄR biasen — duty kollapsar
  // inte mot 0 nära mål utan landar här. ──
  const ff = Math.max(0, input.feedforwardDuty)

  // ── Liten trim-I ovanpå feedforward för residual bias. Nollställs vid
  // mode-byte. Fryses (inte bara klampas) om förra cykelns duty blev
  // begränsad av slew/min-off — annars bygger trimI upp mot ett svar
  // aktuatorn ännu inte hunnit leverera (klassisk windup). ──
  let trimI = input.persistedTrimI
  if (!Number.isFinite(trimI) || Math.abs(trimI) > TRIM_MAX) trimI = 0
  const modeFlipped = input.modeJustSwitched ||
    (input.prevState.lastMode != null && input.prevState.lastMode !== input.mode)
  if (modeFlipped) {
    trimI = 0
    constraints.push('mode-reset')
  } else if (!isStaleSsot) {
    trimI = Math.max(-TRIM_MAX, Math.min(TRIM_MAX, trimI + K.Ki * need * dtMin / 60))
  }

  // ── Kombinera ──
  // Ingen särskild "förbi mål"-logik behövs eller ska finnas här. Formeln är
  // redan kontinuerlig och symmetrisk: vid need=0 (exakt vid mål) blir
  // duty=ff — rätt, det är den nivå som håller stilla mot en konstant
  // ambient-drift (t.ex. värme mot en kallare källare, eller kyla mot en
  // varmare). Vid litet överskott minskar duty en aning under ff; vid stort
  // överskott äter Kp·need till slut upp hela ff och duty når 0 av sig
  // självt. Ett tidigare försök att tvinga duty=0 direkt vid need≤0 var
  // FEL — det slog till även exakt vid need=0 (dvs. exakt vid mål, där ff
  // fortfarande behövs för att hålla stilla), vilket skapade en konstgjord
  // bang-bang-cykel runt målet istället för att lita på den släta tapern
  // som redan fanns. ──
  const rawDuty = ff + trimI + pTerm - dBrake
  let duty = Math.max(0, Math.min(1, rawDuty))

  // ── Extern säkerhet: kompressor/glykol-mättnad ──
  if (isCooling && input.coolingUtilization != null && input.coolingUtilization >= 0.90) {
    duty = Math.min(duty, ff + 0.10)
    constraints.push('util-sat-cap')
  }

  // ── Min-off-skydd (kylning): ingen ny duty>0 inom 5min efter en 0%-cykel. ──
  const dutyPctPreSlew = Math.round(duty * 100)
  const lastZeroDutyAt = dutyPctPreSlew === 0
    ? (input.prevState.lastDutyPct === 0 && input.prevState.lastZeroDutyAt ? input.prevState.lastZeroDutyAt : now)
    : input.prevState.lastZeroDutyAt
  let minOffBlocked = false
  if (isCooling && duty > 0 && input.prevState.lastZeroDutyAt) {
    const minutesSinceOff = (nowMs - new Date(input.prevState.lastZeroDutyAt).getTime()) / 60000
    if (minutesSinceOff < MIN_OFF_MIN) {
      duty = 0
      minOffBlocked = true
      constraints.push(`min-off(${minutesSinceOff.toFixed(1)}m)`)
    }
  }

  // ── Slew-cap: max ±5%/cykel, TILLÄMPAS ALLTID (utom vid mode-switch).
  // Ingen bypass vid "förbi mål" längre — se motivering ovan: tapern är
  // redan slät, det finns inget hopp att släppa fritt ifrån. Ett tidigare
  // undantag för |need|>0.5° togs bort av samma skäl (verklig drift visade
  // att stora fel är precis där duty svänger som mest, inte där den behöver
  // fri respons). Reglering sker kontinuerligt på avstånd (P) + hastighet
  // (D) ovanpå en fast bas (feedforward) inom samma ±5%/cykel-tak, alltid,
  // utan specialfall. ──
  const lastDutyFrac = (input.prevState.lastDutyPct ?? 0) / 100
  const slewBypass = input.modeJustSwitched
  let slewLimited = false
  if (!slewBypass) {
    const delta = duty - lastDutyFrac
    if (Math.abs(delta) > SLEW_PER_CYCLE) {
      duty = Math.max(0, Math.min(1, lastDutyFrac + Math.sign(delta) * SLEW_PER_CYCLE))
      slewLimited = true
      constraints.push(`slew-cap(${(delta*100).toFixed(1)}%→${(Math.sign(delta)*SLEW_PER_CYCLE*100).toFixed(0)}%)`)
    }
  }


  // ── Anti-windup: om aktuatorn inte kunde leverera vad trimI-tillväxten
  // denna cykel förutsatte (slew eller min-off begränsade duty), återställ
  // trimI till förra cykelns värde — annars fortsätter den växa mot ett svar
  // som ännu inte landat. ──
  if (slewLimited || minOffBlocked) {
    trimI = input.persistedTrimI
    constraints.push('trim-freeze-clamped')
  }

  const nextState: V5PidState = {
    lastSsot: input.actualTemp,
    lastSsotAt: now,
    ssotSmoothed: ssotFiltered,
    ssotHistory: (() => {
      const prev = input.prevState.ssotHistory ?? []
      const kept = prev.filter(e => (nowMs - new Date(e.t).getTime()) / 60000 <= HISTORY_KEEP_MIN)
      kept.push({ t: now, v: ssotFiltered })
      return kept
    })(),
    trimI,
    lastDutyPct: Math.round(duty * 100),
    lastZeroDutyAt,
    lastMode: input.mode,
  }

  return { duty, trimI, p: pTerm, d: dBrake, ff, constraints, nextState }
}



// ============================================================
// Thermal Rate Learning
// ============================================================

interface RateFilter {
  accept: (ratePerHour: number, temp: number, target: number) => boolean
  normalise?: (rate: number) => number
}

interface LearnRateResult {
  rate: number
  sampleCount: number
}

/**
 * Shared core: learn a thermal rate from temp_controller_history using
 * pluggable filter logic.
 */
async function learnRateCore(
  supabase: any,
  controllerId: string,
  paramName: string,
  filter: RateFilter,
  skipLearning: boolean,
  logPrefix: string,
): Promise<LearnRateResult | null> {
  // 1. Cache check — reuse recent value
  const { data: existing } = await supabase
    .from('fermentation_learnings')
    .select('learned_value, sample_count, last_updated_at')
    .eq('controller_id', controllerId)
    .eq('parameter_name', paramName)
    .maybeSingle()

  if (existing && existing.last_updated_at) {
    const hoursSince = (Date.now() - new Date(existing.last_updated_at).getTime()) / (1000 * 60 * 60)
    if (hoursSince < 2 && existing.sample_count >= 3) {
      return { rate: parseFloat(String(existing.learned_value)), sampleCount: existing.sample_count }
    }
  }

  // 2. Fetch recent history
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  const { data: history } = await supabase
    .from('temp_controller_history')
    .select('actual_temp, target_temp, cooling_enabled, recorded_at')
    .eq('controller_id', controllerId)
    .gte('recorded_at', sixHoursAgo)
    .order('recorded_at', { ascending: true })
    .limit(200)

  if (!history || history.length < 5) {
    return existing ? { rate: parseFloat(String(existing.learned_value)), sampleCount: existing.sample_count } : null
  }

  // 3. Compute rates with parametric filter
  const norm = filter.normalise ?? ((r) => r)
  const rates: number[] = []
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1]
    const curr = history[i]
    const currTemp = parseFloat(String((curr as any).actual_temp))
    const prevTemp = parseFloat(String((prev as any).actual_temp))
    const tempDiff = currTemp - prevTemp
    const timeDiffHours = (new Date(curr.recorded_at).getTime() - new Date(prev.recorded_at).getTime()) / (1000 * 60 * 60)

    if (timeDiffHours < 0.01 || timeDiffHours > 0.5) continue

    const ratePerHour = tempDiff / timeDiffHours
    const temp = currTemp
    const target = parseFloat(String(curr.target_temp))

    if (filter.accept(ratePerHour, temp, target)) {
      rates.push(norm(ratePerHour))
    }
  }

  if (rates.length < 2) {
    return existing ? { rate: parseFloat(String(existing.learned_value)), sampleCount: existing.sample_count } : null
  }

  // 4. p80 percentile
  rates.sort((a, b) => a - b)
  const p80 = rates[Math.floor(rates.length * 0.8)]

  // 5. Persist via EMA or return cached
  if (skipLearning) {
    console.log(`${logPrefix} skip learning (idle) — p80=${p80.toFixed(2)}`)
    return existing
      ? { rate: parseFloat(String(existing.learned_value)), sampleCount: existing.sample_count }
      : { rate: Math.round(p80 * 100) / 100, sampleCount: 0 }
  }

  const result = await updateLearnedParam(supabase, controllerId, paramName, p80, 0.1, 20.0)
  const rounded = Math.round(result.newValue * 100) / 100

  console.log(`${logPrefix} ${rounded.toFixed(2)}°C/h (${rates.length} samples, p80=${p80.toFixed(2)}, prev=${result.oldValue.toFixed(2)})`)

  return { rate: rounded, sampleCount: result.sampleCount }
}

// ============================================================
// Public wrappers (preserve existing signatures)
// ============================================================

const HEATING_FILTER: RateFilter = {
  accept: (r, temp, target) => r > 0.3 && temp < target,
}
const COOLING_FILTER: RateFilter = {
  accept: (r, temp, target) => r < -0.3 && temp > target,
  normalise: Math.abs,
}

function getThermalRateParamName(mode: 'heating' | 'cooling', tempBucket?: string): string {
  return tempBucket ? `thermal_rate_${mode}:${tempBucket}` : `thermal_rate_${mode}`
}

/**
 * Learn and retrieve the hardware thermal rate (°C/hour) for a controller.
 */
export async function learnThermalRate(
  supabase: any,
  controllerId: string,
  mode: 'heating' | 'cooling',
  skipLearning?: boolean,
  tempBucket?: string,
): Promise<number | null> {
  const filter = mode === 'heating' ? HEATING_FILTER : COOLING_FILTER
  const globalParamName = getThermalRateParamName(mode)
  const globalLogPrefix = `🏎️ Thermal rate ${controllerId} [${mode}]:`

  if (!tempBucket) {
    const result = await learnRateCore(
      supabase, controllerId, globalParamName, filter,
      !!skipLearning, globalLogPrefix,
    )
    return result ? result.rate : null
  }

  const bucketFilter: RateFilter = {
    accept: (r, temp, target) => getTempBucket(temp) === tempBucket && filter.accept(r, temp, target),
    normalise: filter.normalise,
  }

  const [bucketResult, globalResult] = await Promise.all([
    learnRateCore(
      supabase,
      controllerId,
      getThermalRateParamName(mode, tempBucket),
      bucketFilter,
      !!skipLearning,
      `🏎️ Thermal rate ${controllerId} [${mode}:${tempBucket}]:`,
    ),
    learnRateCore(
      supabase,
      controllerId,
      globalParamName,
      filter,
      !!skipLearning,
      globalLogPrefix,
    ),
  ])

  if (bucketResult && bucketResult.sampleCount >= 3) return bucketResult.rate
  return globalResult?.rate ?? bucketResult?.rate ?? null
}

/**
 * Learn glycol cooler thermal rate under different load conditions.
 */
export async function learnGlycolCoolerRate(
  supabase: any,
  coolerId: string,
  currentLoad: number,
  skipLearning?: boolean,
): Promise<{ rate: number; sampleCount: number } | null> {
  const loadBucket = currentLoad >= 2 ? '2plus' : String(currentLoad)
  return learnRateCore(
    supabase, coolerId, `glycol_rate:load_${loadBucket}`, COOLING_FILTER,
    !!skipLearning, `🧊 Glycol rate ${coolerId} [load=${loadBucket}]:`,
  )
}

/**
 * Get all learned glycol rates for a cooler (all load buckets).
 */
export async function getGlycolRatesSummary(
  supabase: any,
  coolerId: string
): Promise<Record<string, { rate: number; sampleCount: number }>> {
  const { data } = await supabase
    .from('fermentation_learnings')
    .select('parameter_name, learned_value, sample_count')
    .eq('controller_id', coolerId)
    .like('parameter_name', 'glycol_rate:%')

  const result: Record<string, { rate: number; sampleCount: number }> = {}
  if (data) {
    for (const row of data) {
      const bucket = row.parameter_name.replace('glycol_rate:', '')
      result[bucket] = { rate: parseFloat(String(row.learned_value)), sampleCount: row.sample_count }
    }
  }
  return result
}

// ============================================================
// Feedforward duty learner
//
// Modellerar termisk balans från senaste 6h historik:
//   ambient_gain (°/h)  = medel positiv drift när duty=0 (cooling) / negativ (heating)
//   cool_response (°/h per 1% duty) = medel drift-derivata per duty när duty>0
//   required_duty = ambient_gain / cool_response   (fraktion 0..1)
//
// Persisteras i fermentation_learnings som `feedforward_duty:{mode}` och är
// under V6 den PRIMÄRA biasen i duty-formeln (inte längre ett golv bakom en
// hold-lock/pre-cool-mekanism) — därför ingen konservativ nedskalning här
// längre;träffar vi fel blir det trimI:s jobb att korrigera det lilla som
// återstår. 2h-cache via last_updated_at undviker att räkna om varje cykel.
// ============================================================
export async function learnFeedforwardDuty(
  supabase: any,
  controllerId: string,
  mode: 'heating' | 'cooling',
  deltaT?: number | null,
): Promise<number> {
  const paramName = `feedforward_duty:${mode}`
  // ΔT-skalning: lagrat ff normaliseras mot DELTA_T_REF (större ΔT → mindre
  // ff behövs för balans). Motsatt riktning mot process_gain. Endast cooling
  // har glykol-ΔT-koppling. `null` deltaT → ingen skalning (bakåtkompat).
  const useDeltaScaling = mode === 'cooling' && deltaT != null && Number.isFinite(deltaT) && deltaT > 0
  const denorm = (stored: number) => useDeltaScaling ? stored * (DELTA_T_REF / (deltaT as number)) : stored
  const norm   = (observed: number) => useDeltaScaling ? observed * ((deltaT as number) / DELTA_T_REF) : observed
  // Statisk, ICKE-persisterad fallback för det smala engångsfallet: denna
  // controller_id+mode har ALDRIG körts förut (inget `existing`-värde alls).
  // feedforward_duty/process_gain nycklas bara på (controller_id, mode) —
  // inte per bryggning — så en andra brygg på samma rigg får redan förra
  // brygdens lärda värde gratis via `existing`. Detta täcker bara det
  // verkliga första-gången-fallet, inte "första 6h denna brygd".
  // Värdet är er egen observerade typiska feedforward (3–6%), inte en
  // universell konstant. Skrivs ALDRIG till DB — bara ett bättre "ingen data
  // än"-gissning för kontrolloopen, motsvarande hur deriveGains redan
  // faller tillbaka på statisk Kp/Kd när processGain saknas.
  const FEEDFORWARD_DEFAULT = 0.05
  const fallback = (existing: { learned_value: unknown } | null | undefined) =>
    existing ? denorm(parseFloat(String(existing.learned_value)) || FEEDFORWARD_DEFAULT) : FEEDFORWARD_DEFAULT

  // Cache-hit: skip recompute if <2h old
  const { data: existing } = await supabase
    .from('fermentation_learnings')
    .select('learned_value, sample_count, last_updated_at')
    .eq('controller_id', controllerId)
    .eq('parameter_name', paramName)
    .maybeSingle()
  if (existing?.last_updated_at) {
    const hoursSince = (Date.now() - new Date(existing.last_updated_at).getTime()) / 3_600_000
    if (hoursSince < 2 && existing.sample_count >= 3) {
      return denorm(parseFloat(String(existing.learned_value)) || FEEDFORWARD_DEFAULT)
    }
  }

  const sixHoursAgo = new Date(Date.now() - 6 * 3_600_000).toISOString()
  const { data: history } = await supabase
    .from('temp_controller_history')
    .select('actual_temp, duty_pct, recorded_at')
    .eq('controller_id', controllerId)
    .gte('recorded_at', sixHoursAgo)
    .order('recorded_at', { ascending: true })
    .limit(300)

  if (!history || history.length < 6) {
    return fallback(existing)
  }

  const ambient: number[] = []            // °/h drift while duty=0
  const perPctResp: number[] = []         // °/h per 1% duty while duty>0

  for (let i = 1; i < history.length; i++) {
    const p = history[i - 1] as any
    const c = history[i] as any
    const pt = parseFloat(String(p.actual_temp))
    const ct = parseFloat(String(c.actual_temp))
    if (!Number.isFinite(pt) || !Number.isFinite(ct)) continue
    const dtH = (new Date(c.recorded_at).getTime() - new Date(p.recorded_at).getTime()) / 3_600_000
    if (dtH < 0.05 || dtH > 0.6) continue    // 3–36 min windows
    const rate = (ct - pt) / dtH              // °/h, positive = warming
    const duty = parseFloat(String(c.duty_pct ?? p.duty_pct ?? 0)) || 0

    if (mode === 'cooling') {
      if (duty <= 0.5 && rate > 0.02) ambient.push(rate)
      if (duty >= 2 && rate < -0.02) perPctResp.push(-rate / duty)     // °/h per 1%
    } else {
      if (duty <= 0.5 && rate < -0.02) ambient.push(-rate)
      if (duty >= 2 && rate > 0.02) perPctResp.push(rate / duty)
    }
  }

  // n_resp/n_amb-krav höjt 2→4: en enstaka mätning (t.ex. under en kort
  // glykol-mättnadsepisod) ska inte ensam få bestämma perPct. Komplement
  // till alphaOverride/maxStepFraction i updateLearnedParam-anropen nedan —
  // detta skyddar INPUT-kvaliteten, de skyddar hur mycket EN redan godkänd
  // mätning får flytta det lagrade värdet.
  const MIN_SAMPLES = 4
  if (ambient.length < MIN_SAMPLES || perPctResp.length < MIN_SAMPLES) {
    return fallback(existing)
  }

  const median = (arr: number[]) => {
    const s = [...arr].sort((a, b) => a - b)
    return s[Math.floor(s.length / 2)]
  }
  const ambientGain = median(ambient)         // °/h
  const perPct = median(perPctResp)           // °/h per 1% duty
  if (!(perPct > 0)) return fallback(existing)

  // required duty (fraction) = (°/h ambient) / (°/h per 1% * 100)
  let requiredDuty = ambientGain / (perPct * 100)
  requiredDuty = Math.max(0, Math.min(0.30, requiredDuty))     // safety-cap 30%

  // Explicit alphaOverride=0.10 istället för utils-defaulten (0.5 första 5
  // samplen, sedan 0.2, ingen mätkvalitetsviktning): dessa två värden matar
  // direkt in i kontrollagens Kp/Kd (via deriveGains) och feedforward-biasen,
  // inte bara ett golv bakom andra skydd som i V5. Ett enskilt avvikande 6h-
  // fönster (t.ex. glykolmättnad en varm eftermiddag ger falskt låg perPct →
  // både uppblåst feedforwardDuty OCH uppblåst Kp samtidigt) ska inte kunna
  // slå igenom 35% på ett steg. process_gain är dessutom en helt ny parameter
  // (sample_count startar på 0) — utan override hade den kört på den mest
  // aggressiva delen av default-schemat under sina första ~10h, exakt när
  // koden är minst validerad.
  //
  // maxStepFraction läggs på ovanpå alpha som ett hårt golv/tak per steg —
  // se learning-utils.ts. Utan detta kan en enda avvikande mätning fortfarande
  // flytta värdet upp till alpha×hela-spannet i ett enda anrop.
  const LEARN_ALPHA = 0.10
  // Normalisera observationen till ΔT_ref-referensramen INNAN den skrivs så
  // EMA:n förblir konsistent oavsett vilken ΔT observationen togs vid.
  const requiredDutyNormalized = norm(requiredDuty)
  const perPctNormalized = useDeltaScaling ? perPct * (DELTA_T_REF / (deltaT as number)) : perPct
  const result = await updateLearnedParam(
    supabase, controllerId, paramName, requiredDutyNormalized, 0.001, 0.30, LEARN_ALPHA, 0.10,
  )
  // Persistera processförstärkningen (°/h per 1% duty) separat — samma
  // kvalitetsgrind (n_resp≥2) som feedforward-dutyn ovan, så deriveGains
  // alltid får en mätning som redan är verifierad "på riktigt".
  // clampMax sänkt 5.0→1.0: 5.0°C/h per 1% duty är fysiskt orimligt för den
  // här processen (var bara en aldrig-avsedd-att-nås säkerhetsgräns) — en
  // realistisk gräns gör maxStepFraction faktiskt meningsfull istället för
  // att vara 10% av ett spann som aldrig används.
  await updateLearnedParam(
    supabase, controllerId, `process_gain:${mode}`, perPctNormalized, 0.0001, 1.0, LEARN_ALPHA, 0.10,
  ).catch(() => null)
  const dtStr = useDeltaScaling ? ` ΔT=${(deltaT as number).toFixed(1)}°` : ''
  console.log(`🔮 Feedforward duty ${controllerId} [${mode}]${dtStr}: ambient=${ambientGain.toFixed(2)}°/h, response=${perPct.toFixed(3)}°/h/%, need=${(requiredDuty*100).toFixed(1)}% (n_amb=${ambient.length}, n_resp=${perPctResp.length}) → stored=${(result.newValue*100).toFixed(1)}% effective=${(denorm(result.newValue)*100).toFixed(1)}%`)
  return denorm(result.newValue) || 0
}
