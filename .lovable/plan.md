## Diagnos (loggdata senaste 6h)

**Blå (hold @ 13.0°C):** actual_temp 12.96–13.08°C, spann 0.12°C, duty pulserar 0→1→3→5→7→0% var ~15 min. Mycket stabil men onödigt aktiv pulsering runt setpoint.

**Gul (heating ramp @ 14.5→14.8°C):** actual_temp drev från 14.49 → **15.03°C på 3.5h med duty=0% hela tiden**. Bottenproben ligger 0.7°C under pillen, och `past-target-coast` + `top-overshoot-guard` blockerade all kylning eftersom mode är låst till `heating` av ramp-override och översläng aldrig nådde tröskeln 0.3°C (sakta drift). Det här är dagens enskilt största stabilitetsbrist.

## Tre prioriterade fixar

### 1. Anti-drift watchdog för ramp-override (största vinst)
Idag: cooling tar bara över om `actualTemp − actualTarget > 0.3°C`. Långsam drift under tröskeln går obemärkt.

Lägg till en **trend-trigger**: om `actualTemp` ligger över `actualTarget` *och* har stigit ≥ 0.15°C de senaste 30 min (avläst från `temp_controller_history`) under heating-ramp → tvinga mode-flip till cooling oavsett ramp-override. Symmetriskt för cooling-ramp som driver nedåt.

Implementation: i `controller-adjustments.ts` ramp-override-blocket (~rad 670–720), läs senaste 3 history-raderna för controllern och beräkna trenden. Kostnad: 1 extra select per active controller per minut.

### 2. Hold-deadband runt setpoint
Idag: V3 producerar duty 1–7% även när `|error| < 0.1°C`, vilket ger den synliga pulseringen.

I `computeDutyV3`: om `stepType === 'hold'` och `|avgError| < 0.10°C` och `|pillRate| < 0.05°C/h` → klampa duty till 0, frys integralen (lägg constraint `hold-deadband`). Effekt: Blå går från 0/1/3/5/7%-pulser till rena 0%-fönster när den verkligen är på mål.

### 3. 3-min IIR på controlTemp
Idag: `controlTemp = 0.5·bottomEst + 0.5·pillTempNow` per minut → pill-spikar (BLE-brus, vågrörelse) ger små duty-jitter.

Lägg ett enkelt IIR-filter: `controlTempSmoothed = 0.6·prevControlTemp + 0.4·controlTempNow`, persistera i `pid_state` JSON. Bypass vid mode-switch (`modeJustSwitched`) så vi inte laggar respons. Effekt: dämpar sub-cykel-brus utan synbar tröghet.

## Vad som inte ändras

- **gradient_k inlärning** — redan konvergerad, ingen åtgärd behövs.
- **Offset-blend** (precis tillagd) — behövs ingen justering förrän vi sett den verka 24h+.
- **PWM-extrem-target-swings i loggar** (-5/40/revert) — kosmetiskt, redan mutat i UI.
- **Bottom-undershoot-guard / top-overshoot-guard** — fungerar som tänkt, inget ändras.

## Verifiering efter implementation

24h efter deploy: jämför `STDDEV(actual_temp)` för båda controllers i `temp_controller_history` mot baseline ovan (Blå 0.640, Gul 0.541) och bekräfta att Gul inte längre driver > 0.3°C över target under heating-ramp.

## Filer som rörs

- `supabase/functions/_shared/controller-adjustments.ts` — anti-drift watchdog i ramp-override-blocket
- `supabase/functions/_shared/pid-compensation.ts` — hold-deadband i `computeDutyV3` + IIR på controlTemp
- `supabase/functions/_shared/pid-compensation.ts` `persistPidState` — addera `last_control_temp` till persistat state

Inga schemaändringar. Inga signaturändringar i externa anropare.
