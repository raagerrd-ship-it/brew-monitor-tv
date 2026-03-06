

## Plan: PID tar emot `baseTarget` istället för `actualTarget`

### Problem
`pid-compensation.ts` tar fortfarande emot `actualTarget` (profilmål) och applicerar `compensation = sensorDelta` internt (rad 168, 444). Det borde istället ta emot det redan sensorjusterade `baseTarget` från dual-sensor-modulen som sitt "grundmål", och enbart lägga till/dra ifrån PI-felkorrigering.

### Nuvarande flöde (i pid-compensation.ts)
```text
Input:  actualTarget = profileTarget, sensorDelta
Formel: ctrlTargetPid = actualTarget - sensorDelta + errorCorrection
```

### Önskat flöde
```text
Input:  baseTarget = profileTarget - sensorDelta (från dual-sensor)
Formel: ctrlTargetPid = baseTarget + errorCorrection
```

### Ändringar

**1. `controller-adjustments.ts`** (rad 386-391)
- Skicka `dualSensor.baseTarget` som första parameter istället för `actualTarget`
- Behåll `actualTarget` som separat parameter för loggning och guards som behöver profilmålet
- Skicka inte längre `sensorDelta` — PID behöver det inte

**2. `pid-compensation.ts`**
- Byt namn på parameter `actualTarget` → `baseTarget` (sensorjusterat grundmål)
- Lägg till ny parameter `profileTarget` (för loggning, safety bounds, directional clamp)
- Ta bort `compensation`-variabeln helt (rad 168)
- Ta bort `avgDelta`/`absDelta` som användes för compensation (behåll för D-term delta-historik)
- Förenkla formel rad 444: `ctrlTargetPid = baseTarget + errorCorrection`
- Deadband (rad 276): `deadbandCtrlTarget = baseTarget` (redan justerad)
- Safety bounds (rad 447): `Math.max(profileTarget - maxComp, Math.min(profileTarget + maxComp, ctrlTargetPid))`
- Directional clamp (rad 452-462): jämför mot `profileTarget` (ramp-riktning)
- Pill overshoot guard (rad 357): jämför pill mot `profileTarget`
- Error beräkning (rad 240): `avgError = baseTarget - actualTemp` (oförändrat — baseTarget ÄR det korrekta målet)
- Delta-bypass (rad 492-500): **ta bort helt** — sensorDelta redan inbakat i baseTarget, ingen "delta-driven" rate-limit behövs

**3. Loggning**
- PID-loggar visar `baseTarget` som grundmål
- Decision log behåller `profileTarget` som "Profil"-kolumn, `sensorDelta` som "Δ" (från controller-adjustments), och PI som felkorrigering

### Vad som INTE ändras
- Dual-sensor-modulen (`dual-sensor.ts`) — redan korrekt
- D-term, damping, saturation, ramp-boost — oförändrade
- PWM-logik — oförändrad
- Cooler management — oförändrad
- Frontend — oförändrad

### Filer
1. **EDIT** `supabase/functions/_shared/pid-compensation.ts` — ta bort compensation, använd baseTarget
2. **EDIT** `supabase/functions/_shared/controller-adjustments.ts` — skicka baseTarget till PID

