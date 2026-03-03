

## Granskningsresultat — Kritisk bugg + stabilitetsproblem

### KRITISK BUGG: Duplicerad variabeldeklaration (rad 263-264)

```typescript
const kickTarget = round1(coolerMinTemp - 1)
const kickTarget = round1(coolerMinTemp - 1)  // ← DUPLICATE
```

Denna dubbla `const` kommer att krascha edge-funktionen med ett syntax-/runtime-fel i exakt det scenariot där en hysteres-kick behövs (tank kyler 100%, kylare 0%). Resultatet: **ingen justering görs alls** — kylaren förblir i dead band och tanken överhettas.

### Övriga stabilitetsproblem

**1. Felordning vid kick: DB-flagga sätts före API-anrop**
Rad 272-278: `hysteresis_kick_active = true` skrivs till DB *innan* `applyCoolerTarget` körs. Om API-anropet misslyckas, står flaggan kvar som `true`. Nästa cykel tror systemet att det var en lyckad kick och försöker "reverta" — men det finns inget att reverta. Detta är dock **inte farligt** tack vare kick-stuck guard (rad 232), men det slösar en cykel.

**2. Idle shutdown sätter target baserat på kylarens aktuella temp**
Rad 320: `idleTarget = coolerTemp + coolerHyst`. Om kylaren är vid -5°C → idle = -4.8°C. Kylaren fortsätter köra i onödan. Inte farligt för ölen (tankar är redan vid mål), men slösar energi.

### Plan

1. **Ta bort duplicerad `const kickTarget`** (rad 264) — fixar crashen
2. **Byt ordning på kick-flödet**: sätt DB-flagga *efter* lyckat API-anrop, inte före
3. **Sätt idle-target till minst `effectiveTarget.temp`** istället för `coolerTemp + hyst` — så kylaren stängs av ordentligt

Dessa tre åtgärder eliminerar risken att kylaren "hänger sig" i ett felaktigt tillstånd.

