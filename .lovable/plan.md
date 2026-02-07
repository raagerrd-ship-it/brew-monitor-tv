

## Rullande bildbuffe for bakgrundsverifiering

### Problem
Den nuvarande safeguard-logiken (rad 297-302) jamfor bara `bgSentRef` mot `displayedArtUrl`, vilket inte fanger upp fall dar bakgrunden hamnat ur synk med widgetens aktuella bild -- t.ex. efter cooldown-perioden eller missade realtime-events.

### Losning
Ersatt den enkla `bgSentRef` (en enda URL) med en rullande buffer av 3-4 giltiga bakgrunds-URL:er. Vid varje 5s-poll kontrolleras om den senast skickade bakgrunden tillhor buffern. Om inte, skickas ratt bakgrund till dashboarden.

### Tekniska detaljer

**Fil: `src/components/sonos/SonosWidget.tsx`**

1. **Ny ref** -- `validBgBufferRef = useRef<string[]>([])` -- en array med max 4 URL:er (rullande).

2. **Uppdatera buffern** vid varje tillfalle dar en ny bakgrund skapas eller tas emot:
   - `handleNewImageLoaded` (rad 399-406): lagg till `bg_image_url` i buffern
   - Early swap (rad 164-181): lagg till ny `bg_image_url`
   - Predictive poll track change (rad 106-139): lagg till ny `bg_image_url`
   - 5s poll track change (rad 263-280): lagg till ny `bg_image_url`
   - Realtime callback (rad 351-392): lagg till ny `bg_image_url` nar den accepteras

   En hjalpfunktion `pushToBgBuffer(url)` trimmar buffern till max 4 entries och undviker dubbletter.

3. **Uppgraderad safeguard** i 5s-pollingen (rad 297-302):
   - Hamta den forvantat korrekta bakgrunden: `nowPlaying.bg_image_url || displayedArtUrl`
   - Om `bgSentRef.current` inte matchar denna URL OCH URL:en finns i buffern (dvs den ar giltig/kand), skicka den via `onAlbumArtChangeRef` och uppdatera `bgSentRef`
   - Om URL:en inte ens finns i buffern, lagg till den forst och skicka sedan

4. **Buffern representerar**:
   - Position 0: aldsta kanda bakgrund
   - Position 1: foregaende lat
   - Position 2: nuvarande lat (den som spelas)
   - Position 3: nasta lat (om forladdad)

   Nar en ny URL laggs till och buffern overstiger 4, tas den aldsta bort.

### Resultat
- Bakgrunden verifieras var 5:e sekund mot en kand lista av giltiga URL:er
- Om den hamnat ur synk (t.ex. stuck pa gammal bild) korrigeras den automatiskt
- Ingen extra nätverkstrafik -- allt baseras pa redan kanda URL:er i minnet
- Minimal CPU-paverkan -- bara en enkel array-lookup per poll

