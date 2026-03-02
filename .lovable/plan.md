

## Plan: Rensa och strukturera beslutsloggen

### Problem
Loggen visar duplicerad information (PID-data syns både i `PILL_COMP_STATUS`/`PILL_COMP_ACTION` och i det separata adjustment-kortet), samt operationella steg (START, SETTINGS, FOLLOWED_CONTROLLERS, BATCH_FLUSH, COMPLETE) som skapar brus.

### Lösning — UI-omstrukturering (AutoCoolingDecisionLogs.tsx)

**1. Filtrera bort operationellt brus i expanderad vy**

Dölj dessa steg-typer helt: `START`, `SETTINGS`, `FOLLOWED_CONTROLLERS`, `COMPLETE`, `BATCH_FLUSH`, `BATCH_DB`, `PILL_COMP` (rubrik), `PILL_COMP_SKIP`, `BOOTSTRAP`, `COOLING`, `STALE_SENSOR`.

Visa enbart pipeline-stegen: `SYNC_DATA`, `PILL_COMP_STATUS`, `PILL_COMP_ACTION`, `RAPT_SEND`, `PASS_THROUGH`, `STALL_*`, `ERROR`.

**2. Strukturera expanderad vy som en tydlig pipeline**

Tre visuella sektioner med headers och färgkodning:

```text
┌─────────────────────────────────────┐
│ 📊 Synk-data (SYNC_DATA)           │  ← tabell, som idag
├─────────────────────────────────────┤
│ 🧮 PID-kompensation                │  ← PILL_COMP_STATUS tabell
│    + PILL_COMP_ACTION med broms-    │     badges (inline, ej separat kort)
├─────────────────────────────────────┤
│ 📤 Skickat till RAPT (RAPT_SEND)   │  ← som idag
└─────────────────────────────────────┘
```

**3. Ta bort redundanta adjustment-kort för PID**

Adjustment-kortet (rad 587-685) duplicerar PID-data. Bort med PID-kortet (`pill-comp` category). Behåll kort för glykol, manuell, pass-through.

**4. Integrera PILL_COMP_ACTION i PID-tabellen**

Istället för att visa PILL_COMP_ACTION som rå text i "other entries", lägg till en rad per controller i PID-tabellen med `→ nytt mål` och broms-badges direkt i tabellen.

### Filer att ändra

1. **`src/components/AutoCoolingDecisionLogs.tsx`**
   - Definiera `HIDDEN_STEPS` set och filtrera bort i rendered output
   - Flytta PILL_COMP_ACTION-data in i PID-tabellen (extra kolumn "Nytt mål" + badges)
   - Ta bort PID adjustment-kortet (behåll glykol/manuell/passthrough)
   - Rensa up sektionsordning: Synk → PID → RAPT_SEND → Övrigt

