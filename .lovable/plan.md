## Granskning av temperaturreglering — nuvarande status

### Vad som redan är stabilt (verifierat i kod + senaste logg 09:58)

**Pill-data från RAPT är helt avstängt:**
- `sync-rapt-data-quick` har `pillsViaBle = true` hårdkodat (rad 176). `shouldFetchPills = !pillsViaBle && ...` ⇒ ingen `fetchRaptPills`-anrop, ingen pill-telemetri, ingen pill-upsert.
- När `pillsViaBle` är på byggs `pillTempMap`/`controllerToPillId` från `rapt_pills`-tabellen som BLE-sniffern uppdaterar via `ingest-pill-ble`.
- PID läser `actual_temp` (skrivet av BLE) som SSOT, med pill_temp som fallback.

**Cirkulationsbrytaren fungerar end-to-end:**
- Senaste cykeln (09:58:03) visade `CIRCUIT_OPEN_SKIP: Gul` ✔, `CIRCUIT_OPEN: skippar PWM OFF för Gul → deferred 2 min` ✔, samtidigt som Blå fick 100 % cooling och Kylare justerades till 6.8°C utan att Gul störde RAPT-quotan.
- PWM-OFF defer ökar inte `attempts` (skyddar mot "dead row"-sopning av en pausad controller).
- Heartbeat/revert i `executePwmDutyCycle` är också gated av `openCircuitControllerIds`, så vi spammar inte RAPT med Gul-reverts under cooldown.

**Reglerlogiken (PID + cooler) är stabil:**
- `actualTemp` SSOT med pill-fallback förhindrar NaN→0 % duty.
- Ramp-rate-limit + integral wind-up release + emergency override + capability guards är på plats.
- Cooler-margin separat från PID-burst-flödet ⇒ kylaren regleras även när en tank har öppen krets.

### Kvarvarande små hårdvarings-möjligheter (inte kritiska, men ökar robusthet)

1. **Probe-före-flod när kretsen stänger** — efter 10 min cooldown släpps **alla** bursts + alla pending reverts genom på en gång. Om Gul fortfarande är död rasar streaken upp till 6+ direkt. Bättre: tillåt **en enda revert (PWM OFF) som "probe"** först; om den lyckas → tillåt PID-bursts nästa cykel; om den failar → öppna kretsen igen utan att burnsa 3 RAPT-anrop.

2. **Bounded streak** — `rapt_write_fail_streak` växer ohotat (>100 om hårdvaran är död i ett dygn). Cappa vid `FAIL_THRESHOLD + 2` så `getCircuitState` aldrig läser nonsens-värden.

3. **Notifiering när krets öppnas** — idag skrivs bara `console.error`. Lägg en `pending_notifications`-rad första gången kretsen öppnas (dedupe 1 h) så vi får push:
   > "RAPT-controller Gul svarar inte — PWM pausad i 10 min"

4. **NaN-cleanup i log** — `RATE_LEARN: actual NaN°C/h` syns i loggen när rate ej kan beräknas (delning med 0). Bara kosmetiskt; logga `n/a` istället.

### Förslag

Vill du att jag bygger punkt 1–3 (probe-recovery, bounded streak, notifiering) i en build-runda? Punkt 4 kan jag ta på köpet. Annars är systemet stabilt som det är nu — Gul kommer fortsätta vara pausad var 10:e min utan att störa Blå/Kylare.

### Tekniska detaljer (för punkt 1–3 om vi går vidare)

- `_shared/rapt-circuit-breaker.ts`:
  - Lägg `PARAM_PROBE = 'rapt_circuit_probe_pending'` (0/1).
  - I `recordWriteFailure`: cappa `newStreak = Math.min(current.failStreak + 1, FAIL_THRESHOLD + 2)`.
  - Ny export `consumeProbe(controllerId)` — atomiskt sätt probe=0 och returnera true om den var 1.
  - När `openUntilMs` löper ut: nästa `getOpenCircuits`-call sätter probe=1 för den controllern.
- `execute-pwm-off/index.ts`: om controllern har probe=1, släpp **en** revert genom (inte alla pending för den controllern). Vid success → `recordWriteSuccess` (nollställer streak + probe). Vid fail → `recordWriteFailure` (öppnar krets igen).
- `controller-adjustments.ts`: bursts blockeras tills probe=0 OCH krets stängd (dvs en lyckad revert måste ha gått igenom efter cooldown).
- Notifiering i `recordWriteFailure` när `justOpened=true`: insert i `pending_notifications` med dedupe-check (`type='rapt_controller_dead', controller_id=X, created_at > now()-1h`).
