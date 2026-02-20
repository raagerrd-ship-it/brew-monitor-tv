

# UI-finslipning: Omgang 5

## 1. Dod kod: `ProgressBadge` i FermentationSessionCompact

**Fil:** `src/components/fermentation/FermentationSessionCompact.tsx` (rad 460-479)

Komponenten `ProgressBadge` ar definierad men anvands aldrig i JSX:en — procentvardena renderas inline istallet (rad 443-447). Ta bort hela `ProgressBadge`-komponenten och dess interface.

## 2. Dod kod: `PulseOverlay` anvands aldrig

**Fil:** `src/components/fermentation/FermentationSessionCompact.tsx` (rad 6) och `src/components/fermentation/SessionProgressOverlays.tsx` (rad 37-56)

`PulseOverlay` importeras men renderas aldrig i nagon komponent. Dessutom tar den emot en `color`-prop som aldrig anvands i sin egen implementation. Ta bort:
- Importen av `PulseOverlay` fran `FermentationSessionCompact.tsx`
- Hela `PulseOverlay`-komponenten och dess interface fran `SessionProgressOverlays.tsx`

## 3. Oanvand prop: `centered` i StatCard

**Fil:** `src/components/brew-card/StatCard.tsx` (rad 18, 38)

Proppen `centered` tas emot och destruktureras men anvands aldrig i JSX:en (layout ar alltid centrerad via `items-center justify-center`). Ta bort den fran interfacet och destruktureringen. Uppdatera ocksa `GravityStat.tsx` som skickar `centered` (rad 51).

## 4. Onodigt `subValue={null}` i TempStat

**Fil:** `src/components/brew-card/TempStat.tsx` (rad 225)

`subValue={null}` skickas explicit till StatCard, men `null` ar redan default-beteendet (prop ar optional). Ta bort for renare kod.

## 5. Trailing blank rad i utils.ts

**Fil:** `src/components/brew-card/utils.ts` (rad 55-56)

Filen slutar med en extra tom rad. Rensa sa filen slutar direkt efter sista funktionen.

## Teknisk sammanfattning

- 5 filer berors
- Enbart kodrensning — inga visuella eller logiska andringar
- Alla andringar ar isolerade och riskfria

