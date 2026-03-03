

## Granskning av cooler-management.ts — Autonoma glykolstyrningen

Jag har läst igenom hela filen (1016 rader). Överlag är logiken väl strukturerad och stabil. Här är min analys:

### Styrkor
- Tydlig separation: kylaren bryr sig bara om att upprätthålla marginal under lägsta tankens mål
- Demand guard förhindrar onödiga sänkningar när ingen tank faktiskt kyler
- Relay-aware no-op guard sparar API-anrop vid meningslösa justeringar
- Hysteresis-kick med 15-min cooldown och kick-stuck guard
- Proaktiv look-ahead (1h ramp + 2h nästa steg)
- Inlärning separerad i rate-based (rampar) vs utilization-based (hold)

### Identifierade problem

**1. `setCoolerHysteresis` fungerar inte (RAPT API 404)**
Rad 230 och 285 anropar `setCoolerHysteresis` — men vi vet från konversationen att RAPT API:et returnerar 404 för hysteres-endpoints på TemperatureControllers. Hela hysteresis-kick-flödet (sänk hysteres → kick → revert hysteres) bygger på en funktion som inte fungerar. Kicken med target `minTemp - 1` fungerar, men hysteresis-delen är död kod som genererar tysta fel.

**2. Idle shutdown sätter target ovanför nuvarande temp — men vad händer vid återstart?**
Rad 345: `idleTarget = coolerTemp + hysteresis`. Om kylaren är vid 5°C och hysteres 2°C, sätts idle till 7.2°C. När en tank sedan behöver kylning igen, hanteras det av demand guard + normal apply — detta fungerar. Inget problem.

**3. Inlärningens min/max-gränser**
`updateLearnedParam` har bounds 2.0–15.0 för margin och 0.5–20.0 för min_effective. 20°C min_effective margin verkar överdrivet högt som övre gräns — i praktiken borde en marginal aldrig behöva vara >10°C. Dock en kosmetisk fråga, inte ett funktionellt problem.

### Rekommenderad plan

**Enda åtgärd som behövs:** Ta bort alla `setCoolerHysteresis`-anrop och förenkla hysteresis-kick-flödet.

Konkret:
1. **Rad 228-238 (hysteresis restore):** Ta bort — RAPT API stöder inte detta. Behåll bara flagg-rensningen.
2. **Rad 284-299 (hysteresis kick steg 1):** Ta bort hysteresis-sänkningen. Behåll kick-target och DB-flaggan.
3. **Ta bort importen av `setCoolerHysteresis`** från `temp-utils.ts`.
4. **Ta bort `pre_kick_cooling_hysteresis`-hanteringen** i DB-uppdateringarna (sätts/läses men gör inget).

Resultatet: kicken sätter fortfarande target till `minTemp - 1°C` (fungerar) och revert hanteras nästa cykel (fungerar). Enda skillnaden är att vi slutar göra meningslösa API-anrop som ger 404.

### Teknisk sammanfattning

```text
Före:  kick = sänk hysteres + sänk target → revert hysteres + revert target
Efter: kick = sänk target → revert target
```

Resten av logiken (demand guard, utilization, inlärning, proaktiv, rate-limit) ser stabil och korrekt ut.

