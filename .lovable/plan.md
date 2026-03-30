

# Heating Session Cap — bara vid "hold", inte vid ramp

## Problem
Controller Grön kör 10% heating-bursts i 30–60 minuter kontinuerligt, vilket bygger upp termisk tröghet och orsakar oscillationer med ~6 timmars period. PID:n kan inte gå lägre än 10% (lägsta icke-noll-steg), så den "låser" sig.

## Lösning
Inför en "macro duty cycle" som begränsar hur länge kontinuerlig uppvärmning får köra innan ett vilopass tvingas fram. **Gäller enbart hold-läge** — under aktiva ramper (gradual_ramp/ramp) ska uppvärmningen vara obegränsad.

## Hur det fungerar

1. Spåra `heating_session_minutes` i `fermentation_learnings` per controller
2. Varje gång en heating burst körs (10–90% duty) och controllern **inte** rampar → öka räknaren med burst-minuter
3. När räknaren når **10 minuter** → tvinga duty till 0 i **30 minuter** (spara `heating_rest_until` timestamp)
4. Under viloperioden: clampa heating duty till 0, logga `HEATING_REST`
5. Auto-reset: om PID naturligt ger 0% duty → nollställ räknaren (inget tvångsvilopass behövs)
6. Under ramp (`isProfileRamp === true`): hoppa över all session-cap-logik helt

## Implementation

### Fil: `supabase/functions/_shared/controller-adjustments.ts`

**Före heating-burst-exekveringen (rad ~646)**, lägg till:

```typescript
// ── Heating Session Cap (hold-only) ──
const HEATING_SESSION_CAP_MIN = 10
const HEATING_REST_MIN = 30

// Only apply session cap during hold (not during ramps)
if (!isProfileRamp && pidMode === 'heating' && dutyPct > 0) {
  const sessionParam = await getLearnedParam(supabase, fc.controller_id, 'heating_session_minutes', 0)
  const restParam = await getLearnedParam(supabase, fc.controller_id, 'heating_rest_until', 0)
  const restUntil = restParam.value  // unix timestamp in ms, 0 = no rest
  const now = Date.now()

  if (restUntil > now) {
    // Force rest active
    log('HEATING_REST', 'info', `${fc.name}: vilofas aktiv, ${Math.round((restUntil - now)/60000)} min kvar`)
    dutyPct = 0  // clamp to zero
  } else if (sessionParam.value >= HEATING_SESSION_CAP_MIN) {
    // Cap hit → start rest
    const restEnd = now + HEATING_REST_MIN * 60000
    await updateLearnedParam(..., 'heating_rest_until', restEnd, ...)
    await updateLearnedParam(..., 'heating_session_minutes', 0, ...)
    log('HEATING_CAP_HIT', 'action', `${fc.name}: ${sessionParam.value} min heating → ${HEATING_REST_MIN} min vila`)
    dutyPct = 0
  } else {
    // Accumulate: add this burst's minutes
    const burstMin = currentBurstMin  // already calculated
    await updateLearnedParam(..., 'heating_session_minutes', sessionParam.value + burstMin, ...)
  }
}

// Reset counter when PID outputs 0% naturally (and not in forced rest)
if (!isProfileRamp && pidMode === 'heating' && dutyPct === 0 && !forcedRest) {
  await updateLearnedParam(..., 'heating_session_minutes', 0, ...)
}
```

### Varför inte vid ramp?
Vid ramp (t.ex. höja från 13°C till 20°C) **behöver** controllern köra kontinuerligt tills målet nås. Session cap skulle göra rampen onödigt långsam. Oscillationsproblemet uppstår bara vid hold, där PID:n pendlar kring ett stabilt mål.

### Parametrar (tunable via fermentation_learnings)
| Parameter | Default | Beskrivning |
|-----------|---------|-------------|
| `HEATING_SESSION_CAP_MIN` | 10 | Max ackumulerade uppvärmningsminuter före vila |
| `HEATING_REST_MIN` | 30 | Viloperiod efter cap |

### Förväntat resultat
**Före**: 10% duty × 60 min kontinuerligt → 6 min total uppvärmning → termisk tröghet → overshoot

**Efter**: 10% duty × 10 min → ~1 min uppvärmning → 30 min vila → inertia dissiperar → ingen overshoot. Upprepas ~2× per timme.

