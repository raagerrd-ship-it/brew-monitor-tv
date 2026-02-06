

## Delad header mellan Dashboard och Settings + full bredd

### Oversikt
Extrahera dashboard-headern till en delad komponent som anvands pa bade Dashboard och Settings. Settings-sidan far full bredd istallet for `max-w-4xl`.

### Andringar

**1. Skapa `src/components/DashboardHeader.tsx`** (ny fil)
- Extrahera header-JSX fran `BrewingDashboard.tsx` (rad 298-355): Logo, RaptControllerBar, Clock, Settings-kugghjul
- Extrahera aven `RaptControllerBar`-subkomponenten (den ar redan memo:ad)
- Props: `controllers`, `pills`, `onControllerClick?` (valfritt — pa Settings klickar man inte pa controllers), `hasAlbumArtBackground` (for transparens i TV-mode)
- Headern hamtar INTE egen data — den tar emot allt via props
- Settings-kugghjulet markeras visuellt aktivt nar man ar pa `/settings` (via `useLocation`)
- "Logga ut"-knappen laggs till i headern (hoger sida, bredvid kugghjulet, bara synlig pa `/settings`)

**2. Uppdatera `src/components/BrewingDashboard.tsx`**
- Ersatt inline header-JSX med `<DashboardHeader />`
- Skicka controllers, pills, onControllerClick, och albumArtUrl som props
- Ta bort `RaptControllerBar` fran denna fil (den flyttas till DashboardHeader)

**3. Uppdatera `src/pages/Settings.tsx`**
- Importera `DashboardHeader`
- Hamta controllers och pills via Supabase-queries (liknande befintlig `loadAvailableControllers` — den finns redan i Settings!)
- Formatera controllers-datan till `TempController[]`-typen som headern forvantar
- Ta bort "Tillbaka till Dashboard"-knappen (logotypen i headern gar till `/`)
- Ta bort den separata "Logga ut"-knappen fran sidinnehallet
- Byt `container mx-auto max-w-4xl` till `w-full px-6` for full bredd
- Behall `overflow-y-auto` for scrollning under headern
- Lagg till `pt-[56px]` eller liknande offset for headerns hojd

**4. Layout-struktur**

```text
+----------------------------------------------------------+
| [Logo -> /]  [RAPT Controllers]  [Klocka] [Logga ut] [*] |  <- Delad header (56px)
+----------------------------------------------------------+
| [Tabs: Synk | Automatik | Enheter | Ol ]                |
|                                                          |
|  (Full bredd installningsinnehall med px-6 padding)      |
|                                                          |
+----------------------------------------------------------+
```

### Tekniska detaljer

- `DashboardHeader` anvander `useLocation()` for att avgora om kugghjulet ska vara "aktivt" (opacity 100% pa `/settings`)
- Logo-komponenten gor redan `onClick={() => navigate('/')}` eller liknande — verifiera och lagg till om det saknas
- Controllers/pills-data i Settings hamtas fran befintliga `availableControllers`-state + `loadAvailableControllers()`
- Pills-data behover aven hamtas i Settings (finns inte idag) — lagg till en enkel query mot `selected_rapt_pills` + `rapt_pills`
- Logga ut-knappen visas bara nar man ar pa `/settings` (inte pa dashboard)

