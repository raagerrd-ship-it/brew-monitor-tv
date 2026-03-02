

## Analys

Användaren har rätt — det enklaste är att beräkna `actual_temp` **innan** PID anropas, inte som ett separat pipeline-steg. Logiken:

- **Dubbla temperaturgivare PÅ** + pill finns: `actual_temp = avg(pill, probe)`
- **Dubbla temperaturgivare AV** (eller ingen pill): `actual_temp = probe` (= `current_temp`)

I båda fallen får PID exakt samma interface: `actual_temp` och `ctrl_temp` (probe). PID kan sedan räkna `avgDelta = actual_temp - ctrl_temp` internt. När dubbla givare är av blir `avgDelta = 0` automatiskt — PID fungerar fortfarande men gör ingen delta-kompensation.

### Vad detta förenklar

Idag hämtar `calculateCompensatedTarget` sin egen `temp_delta_history` (8 rader) för att beräkna `avgDelta` och `actual_temp` internt. Med den nya modellen:

1. `controller-adjustments.ts` beräknar `actual_temp` per controller före PID-anropet
2. `calculateCompensatedTarget` tar emot `actualTemp` och `probeTemp` som parametrar
3. `avgDelta = actualTemp - probeTemp` — beräknas i PID, men värdet kommer direkt från indata
4. `temp_delta_history`-queryn i PID **behålls** — den används för EMA-utjämning av delta och D-termens rate-beräkning (pillRate, probeRate), inte bara för att räkna ut nuvarande delta

### Ingen ny pipeline-sektion behövs

"Dubbla temperaturgivare" är inte ett eget steg — det är en **pre-beräkning** som sker i `runPidControl` (renamed from `runPillCompensation`). I loggen visas `actual_temp` redan som `avg_temp` i `PILL_COMP_STATUS`.

## Plan

### 1. `controller-adjustments.ts`

- Byt namn `runPillCompensation` → `runPidControl`
- Före PID-loopen: beräkna `actual_temp` per controller:
  ```
  const hasDualSensors = pillCompSettings.enabled && fc.pill_temp != null
  const actualTemp = hasDualSensors 
    ? (fc.pill_temp + fc.current_temp) / 2 
    : (fc.current_temp ?? fc.pill_temp ?? targetTemp)
  ```
- Skicka `actualTemp` och `fc.current_temp` (probeTemp) till `calculateCompensatedTarget`
- PID-mode bestäms av `actualTemp < baseTarget` (inte `pill_temp`)
- **PID körs alltid** — ta bort `if (!pillCompSettings.enabled) return`. Toggeln styr bara om medelvärde beräknas eller ej.
- Pass-through: ta bort `if (pillCompSettings.enabled && fc.pill_temp != null) continue` — PID hanterar alla controllers nu

### 2. `pid-compensation.ts`

- `calculateCompensatedTarget` ny signatur: lägg till `actualTemp: number, probeTemp: number`
- `avgDelta` beräknas som `actualTemp - probeTemp` (direkt, utan delta-history)
- `temp_delta_history`-queryn behålls men används enbart för D-termen (rate-beräkning, EMA)
- Om `avgDelta ≈ 0` (inga dubbla givare), hoppa över delta-kompensation men kör PI-loop ändå

### 3. UI — `AutoCoolingDecisionLogs.tsx`

- Byt sektionsnamn "Pill-kompensation" → "PID-reglering"
- Visa `actual_temp` (medel eller probe beroende på toggle) som "Är-temp" i tabellen
- Slå ihop nuvarande PID-sektion med kompensationssektionen (de delar redan `PILL_COMP_STATUS`)

### 4. Settings-toggle

- Byt etikett "Pill-kompensation" → "Dubbla temperaturgivare"
- Tooltip: "Använd medelvärde av Pill och Probe som är-temperatur. Avaktivera om du bara har en givare."

### Filer som ändras

- `supabase/functions/_shared/controller-adjustments.ts` — pre-beräkning av actual_temp, rename, PID alltid aktiv
- `supabase/functions/_shared/pid-compensation.ts` — ta emot actualTemp/probeTemp, avgDelta från indata
- `src/components/AutoCoolingDecisionLogs.tsx` — slå ihop sektioner, rename
- Settings-komponent — toggle-etikett

