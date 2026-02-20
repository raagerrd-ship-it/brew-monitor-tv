
# UI-finslipning: Omgang 4

## 1. Dod kod: `getStatGlowStyles` anvands inte

**Fil:** `src/components/brew-card/utils.ts` (rad 56-69) och `src/components/brew-card/index.ts` (rad 8)

Funktionen `getStatGlowStyles` exporteras men importeras aldrig i nagon komponent. Ren dod kod som bor tas bort.

## 2. Etikettbild-placeholder: rundare fallback

**Fil:** `src/components/brew-card/BrewCard.tsx` (rad 113-123)

Nar etikettbilden laddas visas en tom gratorig fyrkant (`bg-muted/30`). Tva forbattringar:
- Lagg till en subtil laddningsindikation med en `skeleton`-liknande gradient i bakgrunden
- Lagg till `loading="lazy"` pa `<img>`-taggen for battre prestanda

## 3. Stat-kortens grid: femte kortet (Batteri) centrerat

**Fil:** `src/components/brew-card/BrewCard.tsx` (rad 258-265)

Stat-griden har 3 kolumner och 2 rader. Gravity tar `rowSpan=2`, sa rad 1 har: Gravity (span 2) + ABV + Temp, och rad 2 har: (Gravity fortsatter) + Utjasning + Batteri. Det ar 5 kort i en 3x2 grid dar Gravity tar 2 rader — layouten ar redan korrekt. Ingen andring behovs har.

## 4. ABV och Utjasning: fadade procenttecken

**Fil:** `src/components/brew-card/AbvStat.tsx` och `src/components/brew-card/AttenuationStat.tsx`

For konsekvens med BatteryStat (som fadar decimalen) bor procenttecknet i ABV och Utjasning ocksa vara svagt fadat:
- `5.1%` blir `5.1` + fadat `%`
- `77%` blir `77` + fadat `%`

Detta ger en enhetlig "viktigast forst"-hierarki dar siffran dominerar och enheten ar nedtonad.

## 5. Trailing newline i utils.ts

**Fil:** `src/components/brew-card/utils.ts` (rad 70)

Filen slutar med en extra blank rad efter att funktionerna togs bort i foreg aende omgang. Ren upp sa filen slutar pa rad 69.

## Teknisk sammanfattning

- 4 filer berors
- Inga logikandringar, bara visuell konsekvens och kodrensning
- Alla andringar ar sma och isolerade
