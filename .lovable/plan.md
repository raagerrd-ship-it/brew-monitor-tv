

## Analys: Behövs "(snitt)"/"(ctrl)"-etiketter?

Du har rätt. Ur användarens perspektiv finns det bara **en temperatur** och **ett mål**. Att den beräknas som medelvärde av två sensorer eller läses direkt från probe är en implementationsdetalj som inte hjälper användaren.

### Nuvarande situation

Etiketterna "(snitt)"/"(ctrl)" förekommer på 5 ställen:

| Plats | Nuvarande | Föreslagen |
|---|---|---|
| `TempStat.tsx` (brew-kort) | `getActualTempLabel()` → "(snitt)"/"(ctrl)" | Ta bort label helt — visa bara temperaturen |
| `RaptControllerDialog.tsx` | "Aktuell (snitt)", "Mål (snitt)", "Sätt snittmål" | "Aktuell", "Mål", "Sätt mål" |
| `RaptControllersManagement.tsx` | "Aktuell (snitt)", "Mål (snitt)" | "Aktuell", "Mål" |
| `StepExecutionDisplay.tsx` | "Mål (snitt)", "Snitt 7.2°" | "Mål", "7.2°" |
| `AutoCoolingDecisionLogs.tsx` | "Delta (snitt)" | "Delta" — detta är debug/audit, kan behålla teknisk term |
| `temp-display.ts` | `getActualTempLabel()` returnerar "(snitt)"/"(ctrl)"/"(pill)" | Förenkla eller ta bort |

### Undantag: Tooltip/debug

I tooltips (TempStat rad 202) visas "Snitt: 7.2°" som en av flera rader med Pill/Probe/Ctrl-värden. Där är kontexten teknisk och användaren har aktivt hovrat — **behåll** dessa detaljer i tooltips.

Samma gäller `AutoCoolingDecisionLogs` — det är en debug/audit-vy, tekniska termer är förväntade.

### Ändringar

| Fil | Ändring |
|---|---|
| `src/lib/temp-display.ts` | `getActualTempLabel` returnerar alltid `""` (eller ta bort funktionen, ersätt anrop med `""`) |
| `src/components/RaptControllerDialog.tsx` | "Aktuell", "Mål", "Ändra mål", "Sätt mål" — inga suffix |
| `src/components/RaptControllersManagement.tsx` | "Aktuell", "Mål" — inga suffix |
| `src/components/fermentation/StepExecutionDisplay.tsx` | "Mål", och detail utan "Snitt"/"Ctrl"-prefix |
| `src/components/brew-card/TempStat.tsx` | Sluta visa `tempLabel` i huvudvyn (behåll tooltip-detaljer) |

### Vad som INTE ändras

- Tooltip-innehåll i TempStat (Pill/Probe/Snitt-rader) — teknisk detalj vid hover, bra att ha
- `AutoCoolingDecisionLogs` — audit/debug-vy
- `getActualTemp()` beräkningen — den är korrekt och oförändrad
- Backend-logik — inga ändringar

