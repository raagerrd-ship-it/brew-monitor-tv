## Diagnos

Blå har drivit långsamt uppåt från under mål till +0.47°C under 6 timmar, med PWM mest på 0–8%:

```
13:40  12.72°  duty 0%
15:10  13.02°  duty 0%
16:25  13.13°  duty 0%
17:50  13.24°  duty 0%
19:00  13.38°  duty 0%
19:20  13.47°  duty 7%
```

Detta är systematisk underkylning, inte en transient. Tre saker bidrar tillsammans:

1. **Cooling-Ki och Imax sänktes** i förra rundan (Ki 1.8/0.6, Imax 0.4). Integralen hinner inte bygga någon stadig baskylning innan stratifierings-guarden bleder av den (`nextI *= 0.5`).
2. **Stratifierings-guarden fyrar för lätt**: så fort `bottomEst < target − 0.15` (vilket är normalt för en kyld tank) kapas duty till `uP + uFf` och I bleds. Probe ligger nästan alltid under target → guarden står på nästan jämt → I-termen kan aldrig växa.
3. **SSOT-golvet jag la till** kräver `err > 0.3°C` för att aktiveras. Driften från 13.0 till 13.3 sker helt under tröskeln, så ingenting svarar.

Resultat: PID ser "probe är kallt, allt är bra" medan SSOT (bulken) sakta vandrar uppåt.

## Förslag

Tre små, riktade ändringar i `supabase/functions/_shared/pid-compensation.ts`. Värmesidan rörs inte.

### 1. Sänk SSOT-golvets tröskel och gör det proportionellt

Aktivera redan vid `ssotErr > 0.15°C` (istället för 0.3°C) så drift fångas tidigt. Behåll tak på 35%.

```
ssotErr > 0.15 → duty ≥ min(0.35, Kp · ssotErr + uFf)
```

Vid err = 0.2°C ger det 6% golv; vid 0.47°C ger det 14%. Mjuk, proportionell.

### 2. Låt stratifierings-guarden inte blöda I när SSOT är över mål

Idag bleds `nextI *= 0.5` även när bulken är för varm. Det förhindrar att en stadig baskylning byggs upp. Ändring:

```
if (stratGap > 0 && ssotErr <= 0) nextI *= 0.5   // bara bleda när bulken är OK
```

Cap-logiken på duty behålls oförändrad — vi bara slutar nollställa minnet när vi faktiskt har en värmebudget att jobba mot.

### 3. Höj Ki/Imax för cooling-hold marginellt

Återta lite av det vi sänkte, för att tillåta en stadig baskylning:

```
KiPerHour (cooling, hold):  0.6 → 1.0
Imax (cooling):             0.4 → 0.55
```

Fortfarande långt under heating-sidans 1.2/0.70, så dödtidskänsligheten respekteras. Active-cooling (`KiPerHour=1.8`) och Kp rörs inte.

## Constraint-taggar

- `ssot-floor(err=...,duty=...)` — tröskel ändras från 0.3 → 0.15
- `stratified-guard(...)` — beteendet oförändrat, men I-bleed villkoras nu på `ssotErr ≤ 0`

## Verifiering

Efter deploy: titta på `auto_cooling_decision_logs` för Blå under 1–2 timmar. Förvänta:
- `ssot-floor` fyrar runt err=0.15–0.30 med duty 5–10%
- `actual_temp` driver inte över target + 0.2°C i hold
- duty hamnar i 5–12% snarare än 0%-pulser

Om driften fortsätter eskalerar vi (höjer Kp, eller flyttar SSOT-golvet utanför stratifierings-guardens cap).
