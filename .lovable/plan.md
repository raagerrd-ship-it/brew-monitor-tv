

## Optimera bildgenerering -- korrekt storlek och beskärning

### Problem

1. **Bakgrund**: Genereras alltid som 1280x720 men TV:n kan vara 1920x1080 eller annan upplösning. Bilden upskalas av webbläsaren med `cover` + `scale(1.15)`, vilket ger onödig mjukhet/pixlighet.

2. **Widget-albumart**: Rå Spotify-bilder (300-640px breda) laddas ner till en widget som är 280x130px. Onödigt mycket data för en liten yta, och ingen server-side beskärning till widgetens proportioner.

---

### Lösning

#### 1. Dynamisk bakgrundsstorlek

Ändra edge-funktionen `sync-sonos-now-playing` så att bakgrundsbilden genereras i en storlek som matchar målenheten:

- Klienten skickar sin viewport-storlek (`width x height`) som parameter vid server-sync-anrop
- Servern använder dessa mått (med `scale(1.15)` inräknat) som mål istället för hardkodade 1280x720
- Fallback till 1280x720 om inga mått skickas
- Storleken inkluderas i cache-nyckeln så att olika enheter får rätt version

**Filer att ändra:**
- `supabase/functions/sync-sonos-now-playing/index.ts` -- ta emot `width`/`height`, använd i `generateBackground()`
- `src/components/sonos/hooks/types.ts` -- skicka viewport-mått i `triggerServerSync()`
- `src/components/sonos/hooks/useSonosClientPolling.ts` -- skicka viewport-mått vid polling

#### 2. Server-genererad widget-thumbnail

Generera en liten beskuren bild (280x130) för widgeten server-side, spara i storage, och skicka URL:en via `sonos_now_playing`:

- Ny kolumn `widget_art_url` i `sonos_now_playing`
- Edge-funktionen genererar en 280x130 `object-cover`-beskärning av albumarten
- Widgeten använder `widget_art_url` istället för rå Spotify-URL
- Minskar klientens bildladdning dramatiskt (280x130 JPEG ~5-10 KB vs 640x640 ~50-100 KB)

**Filer att ändra:**
- `supabase/functions/sync-sonos-now-playing/index.ts` -- generera widget-thumbnail
- DB-migration: `ALTER TABLE sonos_now_playing ADD COLUMN widget_art_url TEXT`
- `src/components/sonos/SonosWidget.tsx` -- använd `widget_art_url`
- `src/components/sonos/hooks/types.ts` -- lägg till `widget_art_url` i `NowPlaying`

---

### Teknisk detalj: beskärningslogik

**Bakgrund** (cover + scale):
```text
Mål: viewport * 1.15 (för att täcka scale-transform)
Exempel: 1920x1080 TV -> generera 2208x1242
Beskärning: center-crop källbilden till rätt aspect ratio, sedan resize
```

**Widget-thumbnail** (object-cover i 280x130):
```text
Aspect ratio: 280/130 = 2.15:1
Center-crop källbilden till 2.15:1, sedan resize ner till 280x130
```

Beskärningen sker i den befintliga `resizeBilinear`-funktionen med en ny hjälpfunktion `cropToAspectRatio()` som beräknar center-crop-koordinater.

---

### Cache-strategi

Cache-nyckeln utökas med dimensionerna:

```text
Nuvarande: {trackHash}-{settingsHash}-v6.jpg
Ny:         {trackHash}-{settingsHash}-{width}x{height}-v7.jpg
Widget:     {trackHash}-widget-v1.jpg
```

Cleanup-funktionen behålls oförändrad -- den tar redan hand om gamla filer.

---

### Implementationsplan

| Steg | Fil | Ändring |
|------|-----|---------|
| 1 | DB-migration | Lägg till `widget_art_url` och `next_widget_art_url` i `sonos_now_playing` |
| 2 | `sync-sonos-now-playing` | Ny `cropToAspectRatio()` + dynamisk storlek + widget-generering |
| 3 | `types.ts` | Skicka viewport-mått i `triggerServerSync()`, lägg till `widget_art_url` i interface |
| 4 | `useSonosClientPolling.ts` | Skicka viewport-mått vid polling |
| 5 | `SonosWidget.tsx` | Använd `widget_art_url` istället för `album_art_url` |

