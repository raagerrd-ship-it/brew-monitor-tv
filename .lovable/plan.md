
# Forbattringar av olkorten for TV-visning

## A. Bakgrundsikoner i stat-korten

Varje stat-kort skickar redan in en `icon`-prop (termometer, glas, bubblor, batteri) men den renderas aldrig. Ikonen visas nu som en stor, subtil bakgrundsikon i nedre hogra hornet av varje kort -- ger omedelbar visuell igenkanning pa avstand utan att behova lasa labeltexten.

**Fil: `src/components/brew-card/StatCard.tsx`**
- Rendera `icon`-propen som en absolut-positionerad div (ca 70% av kortets hojd, placerad i nedre hogra hornet)
- Opacity ca 8-10% sa den inte stor det numeriska vardet
- `pointer-events-none` sa den inte paverkar klick

## B. Oka textstorlekar for TV-lasbarhet

**Fil: `src/components/brew-card/StatCard.tsx`**
- Default label-storlek: 9px -> 10px

**Fil: `src/components/brew-card/GravityStat.tsx`**
- OG/FG-varden: 7px -> 9px
- Jasningshastighet: 8px -> 10px

**Fil: `src/components/brew-card/BrewCard.tsx`**
- Custom brew badge (#nummer): 7px -> 9px

## Sammanfattning

Tva anderingar, sex filer, inga nya beroenden. Fokus pa att gora korten mer latta att avlasa fran soffa-avstand pa TV.
