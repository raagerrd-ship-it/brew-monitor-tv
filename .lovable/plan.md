

# UI-finslipning: Slutfor enhetsstandardisering

Forra omgangen tackade 5 filer, men det finns fortfarande **~30 synliga instanser** av `°C` i ytterligare 6 frontend-filer. Dashboarden ser bra ut visuellt -- det som aterstar ar konsekvens i alla dialoger, instellningar och loggar.

## Filer att andra

### 1. `src/pages/Settings.tsx`
De flesta kvarvarande `°C` finns har (~20 stallen):
- Rad 1790, 1792: Controller-temperatur i auto-cooling-sektionen
- Rad 1887, 1896-1897, 1913, 1937, 1947-1948: Status-texter for kylautomatik
- Rad 2114-2121: SelectItem-varden for temperatursteg (1°C, 2°C, etc.)
- Rad 2133-2137: SelectItem for min-kyltemperatur
- Rad 2149-2151: SelectItem for hysteres

### 2. `src/components/AutoCoolingDecisionLogs.tsx`
~15 instanser i detalj-panelerna:
- Rad 248: tempChangeStr
- Rad 281, 284, 288, 295, 300, 305: Pill-kompensations-detaljer
- Rad 324, 328: Fermenteringsprofil-detaljer
- Rad 345, 351, 355: Glykolkylare-detaljer
- Rad 372, 378, 382: Overshoot-detaljer
- Rad 401, 405: Stall-detektion-detaljer

### 3. `src/components/CustomBrewDialog.tsx`
- Rad 124: `°C` i datapunktsbeskrivning och `?°C` fallback

### 4. `src/components/RaptControllersManagement.tsx`
- Rad 400: Toast-beskrivning
- Rad 771, 780: Placeholder-text i input-falt (behalles som `°C` da det ar en enhetsetikett i ett tomt falt, men bor ocksa andras for konsekvens)
- Rad 814: Temperaturintervall-visning

### 5. `src/components/fermentation/StartFermentationSessionDialog.tsx`
- Rad 236, 238, 240: Stegbeskrivningar
- Rad 325: Controller-val i select

### 6. `src/components/fermentation/FermentationProfilesManagement.tsx`
- Rad 312, 314, 316, 318: Stegbeskrivningar

### 7. `src/components/brew-card/TempStat.tsx`
- Rad 165: Enbart en kodkommentar (`±3°C`) -- andras for konsistens men paverkar inte UI

## Teknisk sammanfattning

Totalt **~35 textersattningar** over 7 filer. Alla ar enkla strangbyten fran `°C` till `°`. Ingen logik andras. Edge functions (supabase/) lamnas ororada da de ar backend-loggar, inte synliga for anvandaren.

