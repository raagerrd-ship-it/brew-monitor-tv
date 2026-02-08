

## Djupgranskning av Sonos-integrationen -- Slutresultat

### Sammanfattning

Arkitekturen ar valbyggd och foljer beprövade mönster for TV-prestanda (DOM-refs, konsoliderad ticker, prediktiv polling). Efter konsolideringen finns inga redundanta edge-funktioner kvar. Dock finns **5 konkreta problem** kvar att åtgärda:

---

### Problem 1: `prefetchSeconds` sparas men anvands aldrig

Anvandaren kan justera "Forladdning av albumomslag" (10-60s) i installningarna. Vardet sparas till databasen men klienten anvander alltid den hardkodade konstanten `PREFETCH_THRESHOLD_MS = 30000` i `useSonosPlaybackTicker.ts` (rad 137). Init-hooken hamtar inte heller detta varde fran databasen.

**Fix:**
- Hamta `prefetch_seconds` i `useSonosInit` tillsammans med `track_change_offset_seconds`
- Skicka det till tickern via en ref istallet for att anvanda den hardkodade konstanten

---

### Problem 2: Duplicerad token-refresh i 3 edge functions

Token-refresh-logiken (hämta token, kontrollera expiry, POST till Sonos, uppdatera DB) finns kopierad i:
- `sonos-playback-status` (rad 43-72)
- `sync-sonos-now-playing` (rad 371-400)
- `sonos-groups` (rad 42-77)

(`sonos-auth` har en separat refresh-action men det ar ett distinkt anvandningsfall.)

**Fix:**
- Skapa en delad hjalp-fil `supabase/functions/_shared/sonos-token.ts` med en `getValidAccessToken(supabase, clientId, clientSecret)` funktion
- Importera den i alla tre edge functions

---

### Problem 3: Hardkodade Supabase-URL:er i SonosSettings

`SonosSettings.tsx` anvander hardkodade URL:er (`https://plwchuzidrjgyuepwdcl.supabase.co/functions/v1/...`) pa rad 41, 86 och 106, istallet for `import.meta.env.VITE_SUPABASE_URL`. Detta fungerar idag men bryter portabilitet och ar inkonsekvent med resten av kodbasen.

**Fix:**
- Ersatt alla tre forekomster med `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/...`

---

### Problem 4: Fire-and-forget token-uppdatering i `sonos-playback-status`

Pa rad 67-71 i `sonos-playback-status` gors token-uppdateringen som fire-and-forget (`.then(() => {})`). Om uppdateringen misslyckas refreshas token vid varje anrop (var 5:e sekund) -- onödigt API-slöseri mot Sonos.

De andra edge-funktionerna (`sync-sonos-now-playing`, `sonos-groups`) använder `await` korrekt.

**Fix:**
- Lös automatiskt nar token-refresh extraheras till delad hjälpfil (Problem 2), dar `await` anvands.

---

### Problem 5: Stale closure-risk i `useSonosClientPolling`

Effekten beror pa `nowPlaying?.track_name` och `nowPlaying?.playback_state` men anvander `nowPlaying.duration_ms` och `nowPlaying.bg_image_url` inuti poll-callbacken (rad 76, 111). Dessa varden fangas vid effektens start och uppdateras inte om de andras utan att track/state andras. I praktiken ar detta ovanligt men principiellt felaktigt.

**Fix:**
- Anvand `nowPlaying.duration_ms` fran poll-svaret (`data.durationMillis`) som redan görs (rad 76: `data.durationMillis ?? nowPlaying.duration_ms`), sa detta ar redan delvis hanterat
- For `bg_image_url` i bakgrunds-safeguarden: anvand en ref for nowPlaying som uppdateras vid varje render (samma mönster som `onAlbumArtChangeRef`)

---

### Implementationsplan

1. **Skapa `supabase/functions/_shared/sonos-token.ts`** -- delad token-refresh-logik
2. **Uppdatera 3 edge functions** att importera fran den delade filen
3. **Hamta `prefetch_seconds` i `useSonosInit`** och skicka via ref till tickern
4. **Uppdatera `useSonosPlaybackTicker`** att anvanda ref istallet for hardkodad konstant
5. **Ersatt hardkodade URL:er** i `SonosSettings.tsx`

### Vad som redan fungerar bra

- DOM-ref-baserad progress bar (noll React-rerenders)
- Prediktiv polling med retry-logik
- 15s cooldown for Realtime efter spårbyte
- Early swap-logik for sömlösa övergångar
- Server-side bildbehandling (Chromecast belastas inte)
- Chunk-baserad base64-kodning for stora bilder
- 5s grace period for IDLE-tillstånd
- Bakgrunds-synk-säkerhetsmekanismen med rullande buffer

