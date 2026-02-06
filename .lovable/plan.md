

# Server-renderade grafer for TV-mode (forenklad caching)

## Princip
En bild per bryggning. Filen heter `chart_{brew_id}.jpg` och skrivs over (upsert) varje gang. Ingen timestamp i filnamnet, ingen cleanup behövs. Klienten lagger till `?t=...` som query-param for att tvinga browser-cache-busting.

## Andringar

### Steg 1: Skapa Storage bucket `chart-images`
- Public bucket for att Chromecast ska kunna ladda bilden direkt
- Separerat fran album-backgrounds for tydlighet

### Steg 2: Ny edge function `render-brew-chart`
**Fil:** `supabase/functions/render-brew-chart/index.ts`

**Input:** `{ brewId: string }`

**Logik:**
1. Hamta bryggdata fran `brew_readings` (sg_data, og, fg)
2. Hamta controller-temp fran `get_temp_history_sampled` om `linked_controller_id` finns
3. Downsampla till max 60 punkter
4. Bygg SVG-strang manuellt (paths for SG-linje, controller-temp, target-temp, axlar, labels)
5. Konvertera till JPEG via `magick-wasm` (redan anvant i `prepare-album-background`)
6. Ladda upp till `chart-images/chart_{brew_id}.jpg` med `upsert: true`
7. Returnera `{ chartUrl: "...public URL" }`

**Bildstorlek:** 600x300px

**Farger (fran befintliga chartConfig):**
- Bakgrund: mork (`hsl(222 20% 12%)`)
- SG-linje: bla
- Controller-temp: orange area
- Target-temp: streckad orange
- Pill-temp: svag orange linje

### Steg 3: Uppdatera LazyBrewChart for TV-mode
**Fil:** `src/components/brew-chart/LazyBrewChart.tsx`

I TV-mode:
- Ladda INTE Recharts alls (skippa lazy import)
- Anropa `render-brew-chart` edge function med brewId
- Visa resultat-URL:en som en vanlig `<img>` tagg
- Uppdatera var 15:e minut genom att anropa igen (bilden skrivs over pa servern)
- Cache-bust med `?t={timestamp}` pa img-URL:en

### Steg 4: Skicka brewId till LazyBrewChart
**Fil:** `src/components/brew-chart/types.ts`
- Lagg till `brewId?: string` i `BrewChartProps`

**Fil:** `src/components/brew-card/BrewCard.tsx`
- Skicka `brewId={brew.id}` till `LazyBrewChart`

### Steg 5: config.toml
- Lagg till `[functions.render-brew-chart]` med `verify_jwt = false`

## Cache-strategi

| Aspekt | Detalj |
|--------|--------|
| Filnamn | `chart_{brew_id}.jpg` (en fil per bryggning) |
| Uppdatering | Upsert -- skriver over varje gang |
| Klient-refresh | Var 15:e minut, `?t=` for cache-bust |
| Cleanup | Behövs ej -- en fil per bryggning, skrivs over |
| Storlek | ~15-25KB per bild, max ~10 filer totalt |

## Teknisk detalj: SVG-generering

Manuell SVG-konstruktion utan Recharts (som kraver browser-DOM):

```text
1. Berakna x/y-skalning fran data-range till pixel-koordinater
2. Bygg <path d="M x0,y0 L x1,y1 ..."> for varje dataserie
3. Lagg till <line>-element for axlar och grid
4. Lagg till <text> for dag-labels och varden
5. Wrappa i <svg width="600" height="300">
6. Mata in SVG-strang till magick-wasm -> JPEG
```

## Resultat pa Chromecast

| Fore | Efter |
|------|-------|
| ~50-100 SVG DOM-noder per graf | 1 `<img>` element |
| Recharts JS-bundle laddas | Recharts laddas INTE i TV-mode |
| GPU kompositerar SVG varje frame | Statisk rasterbild, noll GPU-arbete |
| Realtidsuppdatering | 15-minutersintervall (tillrackligt for jamning) |

