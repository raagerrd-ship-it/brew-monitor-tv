

# UI-polering: Slutgiltig enhetsstandardisering

Standardisera alla kvarvarande "°C" till "°" over hela kodbasen. Klockans separator behalls som den ar.

## Filer att andra

### `src/components/RaptControllerDialog.tsx`
- Toast-beskrivning, pill-temperatur och slider-visning: byt `°C` till `°`

### `src/components/fermentation/FermentationStepDisplay.tsx`
- Alla temperaturvisningar (~8 stallen): byt `°C` till `°`

### `src/components/brew-chart/BrewChart.tsx`
- Y-axel tick-format och tooltip-formatering: byt `°C` till `°`

### `src/components/controller-chart/ControllerTempChart.tsx`
- Tooltip-formatering: byt `°C` till `°`

### `src/components/AutoCoolingCountdown.tsx`
- Temperaturvisning: byt `°C` till `°`

## Teknisk sammanfattning

Totalt ~15 enkla textersattningar over 5 filer. Alla ar strangbyten fran `°C` till `°`. Ingen logik andras. Klockans separator behalls oforandrad.

