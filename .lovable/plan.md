

# Ta bort klient-overlay och header-gradient

Tar bort de två klient-sidans lager (brightness-overlay och header-gradient) och behåller bara AI-normaliseringen (server) + kontrastfiltret (klient).

## Tekniska detaljer

### `src/components/BrewingDashboard.tsx`

1. **Ta bort brightness overlay** - hela `<div>` med `rgba(0, 0, 0, ${1 - bgBrightness})` (ca rad 373-379)
2. **Ta bort header gradient** - hela `<div>` med `linear-gradient` (ca rad 380-387)
3. **Ta bort `bgBrightness` state** och relaterad kod:
   - `useState(0.65)` (rad 50)
   - Hämtning från DB (rad 77)
   - Realtime-uppdatering (rad 149-151)
4. Behåll `bgContrast` och dess CSS `filter: contrast(...)` som det är

### `src/components/sonos/SonosSettings.tsx`

1. **Ta bort brightness-slidern** och tillhörande state/logik
2. Behåll kontrast-slidern

