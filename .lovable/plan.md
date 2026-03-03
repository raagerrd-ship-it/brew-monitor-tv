

## Analys av nuläget

Kylaren ("Temp Controller Kylare") har **2.0°C hysteres**, vilket betyder att kylarens relä bara slår till när `temp > mål + 2.0°C`. Kylaren ligger just nu på **0.25°C** med mål **0.5°C**, alltså relä-tröskeln är 2.5°C — långt över nuvarande temp.

### Problem 1: Småjusteringar utan effekt
Loggarna visar många steg som 1.2→1.0, 0.9→0.7, 0.7→0.5 (0.2°C ändringar). Med 2°C hysteres ändrar dessa ingenting i reläets beteende. Nuvarande no-op guard är bara **0.1°C** (rad 292 i cooler-management.ts).

### Problem 2: Hysteres-kick oscillation
Mönstret upprepar sig var 5:e minut: kick→revert→kick→revert. Efter reverten är tanken fortfarande vid 100% util och kylaren i dead band, så den kickar igen direkt.

---

## Plan

### 1. Smartare no-op guard — relämedveten
Istället för att bara kolla om `diff < 0.1`, kontrollera om det nya målet faktiskt ändrar kylarens relästatus. Om kylartempen är långt under (eller över) både gamla och nya `target + hysteresis`, skippa justeringen.

**Logik (rad ~290-296 i cooler-management.ts):**
```
// Relay-aware no-op: skip if neither old nor new target
// would change the relay state given current cooler temp
const oldRelayOn = coolerTemp > currentCoolerTarget + coolerHysteresis
const newRelayOn = coolerTemp > clampedTarget + coolerHysteresis
if (oldRelayOn === newRelayOn && diff < coolerHysteresis) {
  log('COOLER_OK', 'pass', `Ändring ${diff.toFixed(1)}°C < hysteres ${coolerHysteresis}°C — relästatus oförändrad`)
  learnFromCurrentState(...)
  return
}
```

### 2. Anti-oscillation för hysteres-kick
Lägg till en cooldown (15 min) efter en kick+revert-cykel. Om `previousWasKick` just reverterades, sätt en tidsstämpel och blockera nya kicks under 15 minuter.

### 3. Kylanalys-loggning
Logga kylarens och tankens faktiska kylprestation (°C/h, relätid, starts) i beslutsloggen så det syns i UI:t. Redan delvis på plats via `measureCoolingRate` — utöka med kylarens egen rate.

### Tekniska detaljer

**Fil: `supabase/functions/_shared/cooler-management.ts`**

- **No-op guard (rad 291-296):** Ersätt `diff < 0.1` med relämedveten logik som tar hänsyn till `coolerHysteresis` och `coolerTemp`
- **Hysteres-kick (rad 227-249):** Lägg till cooldown-check mot senaste kick via `auto_cooling_adjustments`-tabellen (filtrera på `reason LIKE '%Hysteres-kick%'`, 15 min cooldown)
- **Kylanalys:** Mät kylarens egen cooling rate via `measureCoolingRate(supabase, coolerController.controller_id)` och logga i COOLER_STATUS

Edge functions att omdeployera: `auto-adjust-cooling`, `run-automation`

