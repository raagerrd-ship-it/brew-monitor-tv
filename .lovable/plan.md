

## Ta bort alla `current_temp`-fallbacks — `actual_temp` eller `null`

### Problem
Koden har fortfarande `actual_temp ?? getActualTemp(...)` och `actual_temp ?? current_temp` fallbacks på 6 ställen. Om `actual_temp` är `null` faller den tyst tillbaka till rå probe-data, vilket kan ge felaktig temp utan varning.

### Princip
`actual_temp` är SSOT. Är den `null` → visa `null` (dvs "--") så att det syns att data saknas.

### Filer att ändra

**1. `src/hooks/use-controller-dialog.ts` (rad 248)**
```
// Före: ctrl.actual_temp ?? ctrl.current_temp
// Efter: ctrl.actual_temp
const sensorTemp = ctrl.actual_temp ?? null;
```

**2. `src/components/DashboardHeader.tsx` (rad 308)**
```
// Före: controller.actual_temp ?? getActualTemp(controller.pill_temp, controller.current_temp)
// Efter: controller.actual_temp
const displayTemp = controller.actual_temp;
```

**3. `src/components/RaptControllerDialog.tsx` (rad 60)**
```
// Före: currentController.actual_temp ?? getActualTemp(...)
// Efter: currentController.actual_temp
const actualTemp = currentController.actual_temp;
```

**4. `src/components/RaptControllersManagement.tsx` (rad 60)**
```
// Före: (controller as any).actual_temp ?? getActualTemp(...)
// Efter: controller.actual_temp   (ta bort any-cast också)
const displayTemp = controller.actual_temp;
```

**5. `src/components/brew-card/TempStat.tsx` (rad 32)**
```
// Före: (controller as any)?.actual_temp ?? getActualTemp(...) ?? brew.currentTemp
// Efter: controller?.actual_temp ?? null
// brew.currentTemp är pill-temp från brew-readings, separat domän — behåll som sista fallback
const displayTemp = controller?.actual_temp ?? brew.currentTemp;
```

**6. `src/components/fermentation/ActiveFermentationSession.tsx` (rad 64)**
```
// Före: controllerData?.actual_temp ?? getActualTemp(...)
// Efter: controllerData?.actual_temp ?? null
const actualTemp = controllerData?.actual_temp ?? null;
```

**7. `src/components/AutomationFeatureStatus.tsx` (rad 118)**
```
// Före: (cooler as any).actual_temp ?? cooler.current_temp
// Efter: cooler.actual_temp   (ta bort any-cast)
const actualCoolerTemp = cooler.actual_temp;
```

### Ej ändrat
- `getActualTemp()` i `src/lib/temp-display.ts` — kan markeras deprecated/tas bort i framtiden
- Backend edge functions — de skriver `actual_temp`, korrekt
- `brew_readings.current_temp` — annan domän (pill-data på brygg-nivå)
- Diagnostisk text i `RaptControllerDialog` rad 95 som visar "Probe: X° · Pill: Y°" — det är avsiktligt diagnostiskt, ok

### Resultat
Om `actual_temp` saknas visas "--" istället för att tyst falla tillbaka till fel sensor.

