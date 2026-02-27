

## Analys

Editorn har blivit rörig efter alla iterationer. Problem:

1. **Död kod**: `diacetyl_rest` case i `renderStepTypeFields()` (rad 308-358) — finns kvar i renderingen men är borttagen från dropdown
2. **Oanvänd state**: `rampType` sätts men används aldrig i UI
3. **Oanvända imports**: `RAMP_TYPE_LABELS` importeras men används inte
4. **Tomma rader/kommentarer** på rad 188, 263 — kvarlevor
5. **Inkonsekvent "Håll temperatur"-mapping** — samma logik (`['hold', 'wait_for_...'].includes(...)`) dupliceras på 4 ställen istället för en hjälpfunktion
6. **`STEP_TYPE_LABELS` i fermentation.ts** har fortfarande de gamla oanvända etiketterna synliga

## Plan

### 1. Städa FermentationStepEditor.tsx
- Ta bort `rampType` state (rad 46) — oanvänd
- Ta bort `RAMP_TYPE_LABELS` import
- Ta bort hela `case "diacetyl_rest"` i renderStepTypeFields (rad 308-358) — död kod
- Ta bort `case "diacetyl_rest"` i handleSave (rad 145-150) — behåll för bakåtkompatibilitet? Nej, editorn skapar aldrig den typen längre, men om någon öppnar ett gammalt steg... Vi behåller save-logiken men gömmer render-caset. Faktiskt: om step_type = diacetyl_rest laddas i useEffect sätts det till stepType direkt, och renderStepTypeFields har inget case → renderar ingenting. Det är ok. Behåll save-caset för säkerhets skull.
- Ta bort tomma rader vid 188 och 263

### 2. Skapa hjälpfunktion för "Håll temperatur"-label
I `fermentation.ts`, lägg till:
```typescript
export const getStepTypeLabel = (stepType: string): string => {
  if (['hold', 'wait_for_gravity_stable', 'wait_for_sg', 'wait_for_temp'].includes(stepType)) {
    return 'Håll temperatur';
  }
  return STEP_TYPE_LABELS[stepType as StepType] ?? stepType;
};
```

Ersätt alla 4 ställen som har den duplicerade `['hold', 'wait_for_...'].includes(...)` ternary:
- `FermentationStepDisplay.tsx` rad 209, 291
- `FermentationProfilesManagement.tsx` rad 137
- `FermentationSessionCompact.tsx` rad 481

### 3. Städa FermentationStepDisplay.tsx
- `getStepDescription` för `wait_for_temp` (rad 73) är nu en legacy-case som mappas till ramp. Behåll för befintliga sessioner men det är ok.

### Sammanfattning
Ren städning — ingen funktionell ändring, bara bort med död kod, oanvänd state, duplicerad logik → en hjälpfunktion.

