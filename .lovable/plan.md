

# Layout-granskning -- observationer och forslag

Jag har gatt igenom hela dashboarden, settings-sidan och komponenterna noggrant. Overlag ar layouten valdesignad och konsekvent, men har ar saker jag noterat som kan forbattras:

---

## 1. Stats-griden har ojamn cellfordelning

Brew-kortet har en 3x2 stats-grid dar Gravity tar `rowSpan=2` (hela vansterkolumnen). De ovriga 4 stat-korten (ABV, Temp, Utjasning, Batteri) delar pa 4 celler i 2 kolumner. Det fungerar men **Batteri-cellen saknar `colSpan`** -- den ligger ensam i sista raden/kolumnen medan Utjasning ar bredvid. Om man har en tom cell nere till hoger kan det se obalanserat ut. Bor verifieras att alla celler fyller gridet korrekt.

## 2. App.css ar oanvand boilerplate

Filen `src/App.css` innehaller Vite/React standardboilerplate (`.logo`, `.read-the-docs`, `#root`-styling) som aldrig anvands. Den importeras troligen inte ens, men den bor tas bort for att halla projektet rent.

## 3. Headerns controller-bar klipps pa smal skarm

I screenshoten syns att den tredje controllern i header-baren ar avklippt till hoger ("14.9°C 6..."). Controller-baren har `overflow-x-auto` men `scrollbar-hide`, sa det gar att scrolla men anvandaren far ingen visuell ledtrad om att det finns mer innehall. En subtle fade-gradient pa hogerkanten eller en scroll-indikator skulle hjalpa.

## 4. Settings: Dropdowns saknar konsekvent `z-50`

De flesta `SelectContent` har `className="bg-card border-border z-50"` men nagra dropdowns (t.ex. Sonos-sektionen) kan sakna detta, vilket gor dem genomskinliga eller hamnar under andra element.

## 5. Login-sidan -- ej granskad men vard att kolla

Login-sidan ar en separat route som inte granskades. Den bor folja samma morkare design-system.

## 6. Brew-kortens hover-actions forsvinner pa pekskarm

`group-hover:max-w-[80px]` for Share och Event-knapparna fungerar bara med mus. Pa touchskarm visas de aldrig. Overag att alltid visa dem (eventuellt mer subtilt) eller anvanda en long-press/tap-toggle.

## 7. Overflodiga `isMobile`-ternarer i DashboardHeader

Koden har redundanta uttryck som `width: isMobile ? '1rem' : '1rem'` och `width: isMobile ? '0.7rem' : '0.7rem'` i controller-baren. Dessa gor ingen skillnad och bor forenklas.

---

## Forslag till plan

### Steg 1: Rensa bort `App.css` boilerplate
Ta bort oanvand CSS i `src/App.css` (eller hela filen om den inte importeras).

### Steg 2: Fixa controller-bar overflow-indikator
Lagg till en fade-gradient pa hogerkanten av controller-baren nar det finns mer innehall att scrolla till.

### Steg 3: Rensa redundanta ternarer
Forenka `isMobile ? '1rem' : '1rem'`-uttryck i `DashboardHeader.tsx`.

### Steg 4: Forbattra touch-tillganglighet for brew-kort actions
Gora Share/Event-knapparna alltid synliga (med lag opacitet) istallet for enbart hover, sa de fungerar pa pekskarm.

### Steg 5: Sakerstall konsekvent dropdown-styling
Se over alla `SelectContent`-anvandningar och sakerstalla att de har `bg-card border-border z-50`.

