## Genomfört: Separera sensorfusion från PID

### Ändringar

1. **`controller-adjustments.ts`** — `runPillCompensation` → `runPidControl`
   - Pre-beräknar `actualTemp` före PID: dual sensors ON → avg(pill, probe), annars probe
   - Skickar `actualTemp` och `probeTemp` till `calculateCompensatedTarget`
   - PID körs alltid (ingen `if (!enabled) return`)
   - Pass-through skyddar alla aktiva controllers (inte bara pill-comp)

2. **`pid-compensation.ts`** — `calculateCompensatedTarget` tar `actualTemp` och `probeTemp`
   - `avgDelta = actualTemp - probeTemp` beräknas direkt
   - `temp_delta_history` behålls för D-term/rate
   - Backward-compat: parametrarna är optional

3. **`AutoCoolingDecisionLogs.tsx`** — Sektionerna "Pill-kompensation" och "PID-reglering" slogs ihop
   - Ny samlad tabell: Är-temp, Profil, Delta, Komp, → Mål, Damp, Begr., Läge
   - `actual_temp` och `dual_sensors` visas i tabellen

4. **`Settings.tsx`** — Toggle "Pill-kompensation" → "Dubbla temperaturgivare"
