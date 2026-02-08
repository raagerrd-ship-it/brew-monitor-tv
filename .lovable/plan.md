

## Optimera bildgenerering -- korrekt storlek och beskärning

### Status: ✅ Implementerat

Alla steg genomförda:

1. ✅ DB-migration: `widget_art_url` och `next_widget_art_url` tillagda i `sonos_now_playing`
2. ✅ Edge function: `cropToAspectRatio()`, dynamisk storlek baserad på viewport, widget-thumbnail (280x130)
3. ✅ `types.ts`: Viewport-mått skickas i `triggerServerSync()`, `widget_art_url`/`next_widget_art_url` i NowPlaying
4. ✅ `SonosWidget.tsx`: Använder `widget_art_url` med fallback till `album_art_url`

### Cache-nyckelformat
- Bakgrund: `{trackHash}-{settingsHash}-{width}x{height}-v7.jpg`
- Widget: `{trackHash}-widget-v1.jpg`
