

# UI-finslipning: Proffsigare detaljer

Dashboarden ser redan riktigt bra ut. De sista sakerna som sticker ut vid en noggrann granskning ar:

## 1. ABV-etikett: "Abv" till "ABV"

**Fil:** `src/components/brew-card/AbvStat.tsx` (rad 33)

ABV ar en akronym (Alcohol By Volume) och bor skrivas med versaler. Just nu star det "Abv" som label i StatCard. Andras till "ABV".

## 2. Ta bort oanvand `icon`-prop fran StatCard

**Fil:** `src/components/brew-card/StatCard.tsx`

Proppen `icon` tas emot men renderas aldrig i JSX:en. Fyra stat-komponenter (AbvStat, TempStat, AttenuationStat, BatteryStat) bygger SVG-ikoner som aldrig visas. Dod kod gor komponenten rorig.

**Atgard:**
- Ta bort `icon` fran StatCard-interfacet och destruktureringen
- Ta bort hela SVG-ikonberakningen fran AbvStat, TempStat, AttenuationStat och BatteryStat (de rader som skapar `glassIcon`, `thermometerIcon`, `bubblesIcon`, `batteryIcon`)
- Ta bort `icon={...}` props fran varje StatCard-anrop

## 3. Tom-tillstand med glassmorphism-stil

**Fil:** `src/components/BrewingDashboard.tsx` (rad 356-366)

Nar inga ol ar valda visas en vanlig `Card` utan den glassmorphism-stil som resten av dashboarden har. Uppdatera den sa den matchar:
- Lagg till `style` med glassmorphism-bakgrund, border och skugga
- Byt ut den generiska `Card` mot ett `div` med samma stil som brew-korten

## 4. Controller-barens hogergrad

**Fil:** `src/components/DashboardHeader.tsx` (rad 214-219)

Det finns en fade-gradient pa hogersidan av controller-baren som alltid visas, aven nar innehallet inte overflowdar. For ett renare utseende bor denna gradient tas bort (den ar ett kvarlevande fran nar baren var mer kompakt och hade mer overflow-risk).

## Teknisk sammanfattning

- 6 filer berors
- Ingen logik andras, bara visuell polish och kodrensning
- Alla andringarna ar sma och isolerade

