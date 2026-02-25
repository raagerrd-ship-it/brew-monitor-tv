

## Analys: Kvarvarande felkällor med duplicerad ramp-interpolering

### Problem identifierat

Det finns **4 separata implementationer** av ramp-interpolering i kodbasen. Varje implementation beräknar "live Mål" på sitt eget sätt, med subtila skillnader som ger ±0.1-0.2° avvikelser:

```text
┌──────────────────────────────────────────┬────────────────────────────┬──────────────────────┐
│ Plats                                    │ Starttid hämtas från       │ Start-temp hämtas    │
├──────────────────────────────────────────┼────────────────────────────┼──────────────────────┤
│ 1. src/lib/fermentation-target.ts        │ session.step_started_at    │ session.step_start_  │
│    (Frontend — TempStat, Compact)        │                            │ temp                 │
├──────────────────────────────────────────┼────────────────────────────┼──────────────────────┤
│ 2. record-temp-history (Backend)         │ fermentation_step_log      │ föregående stegs     │
│    → sparar profile_target_temp          │ .created_at                │ target_temp          │
├──────────────────────────────────────────┼────────────────────────────┼──────────────────────┤
│ 3. auto-adjust-cooling (Backend)         │ session.step_started_at    │ session.step_start_  │
│    → bestämmer kompenserat mål           │                            │ temp                 │
├──────────────────────────────────────────┼────────────────────────────┼──────────────────────┤
│ 4. process-fermentation-profiles         │ session.step_started_at    │ session.step_start_  │
│    → calculateRampTemp() rad 80-84       │                            │ temp (implicit)      │
└──────────────────────────────────────────┴────────────────────────────┴──────────────────────┘
```

### Felkälla: `record-temp-history` (nr 2) avviker

`record-temp-history` (som sparar det värde snapshots sedan läser) använder **annan logik** än alla andra:

1. **Start-tid**: Hämtar från `fermentation_step_log.created_at` istället för `session.step_started_at`. Det var exakt detta som orsakade problemet du såg (30 min skillnad → fel interpolering).

2. **Start-temp**: Letar bakåt genom föregående stegs `target_temp` istället för att använda `session.step_start_temp` (som lagrar den faktiska controllerns temp vid stegets start).

Det betyder att **det värde som sparas i historiken (och sedan hamnar i snapshots) kan skilja sig från vad frontend, auto-cooling och process-fermentation-profiles beräknar**.

### Lösning

Uppdatera `record-temp-history/index.ts` → `getRampInterpolatedTarget()` att använda samma källa som de andra tre:

1. **Använd `session.step_started_at`** istället för att slå upp `fermentation_step_log.created_at` (eliminerar DB-query + timing-avvikelse)
2. **Använd `session.step_start_temp`** istället för att leta bakåt genom föregående steg (samma faktiska startpunkt)

### Konkreta ändringar

**`supabase/functions/record-temp-history/index.ts`** — funktion `getRampInterpolatedTarget`:
- Ta bort hela DB-queryn mot `fermentation_step_log` (rad 211-217)
- Använd `session.step_started_at` som starttid direkt
- Använd `session.step_start_temp` som start-temp istället för att iterera bakåt genom `steps`
- Resultatet: ~15 rader kod försvinner, en DB-query per ramp-controller elimineras, och värdet matchar exakt det som frontend och andra backend-funktioner beräknar

### Sekundär observation: `FermentationStepDisplay.tsx`

Denna komponent tar emot `targetTemp` som prop och visar det direkt — den gör ingen egen interpolering. Den anropas från `ActiveFermentationSession` som redan bör skicka in rätt interpolerat värde. Ingen ändring behövs här.

### Sammanfattning

En enda fil behöver ändras (`record-temp-history/index.ts`) för att eliminera den sista duplicerade interpoleringslogiken. Efter det använder alla 4 ställen samma beräkning: `step_started_at` + `step_start_temp` + linjär interpolering.

