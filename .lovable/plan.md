
## Omedelbar bakgrundsswap vid låtbyte

### Problem
Vid låtbyte swappar widgeten korrekt `next_album_art_url` och `next_bg_image_url` till aktiva fält i state. Men dashboardens bakgrundsbild (`onAlbumArtChange`) uppdateras bara inuti `handleNewImageLoaded` -- efter att albumbilden triggat sitt `onLoad`-event. Det ger en fördröjning trots att bakgrundsbilden redan är cachad.

### Lösning
Uppdatera `onAlbumArtChange` direkt i trackChange-logiken (runt rad 105-121 i `SonosWidget.tsx`), istället för att vänta på albumbildens `onLoad`.

### Tekniska ändringar

**`src/components/sonos/SonosWidget.tsx`**

1. I `pollForNewTrack` (rad 102-121), efter att ha swappat `next_bg_image_url` till `bg_image_url`, anropa `onAlbumArtChangeRef.current` direkt med den nya bg-URL:en:

```typescript
if (trackChanged) {
  localProgressRef.current = data.positionMillis;
  setLocalProgress(data.positionMillis);
  setNowPlaying(prev => {
    if (!prev) return prev;
    const newBgUrl = prev.next_bg_image_url || prev.bg_image_url;
    const newArtUrl = prev.next_album_art_url || prev.album_art_url;
    // Immediately update dashboard background
    onAlbumArtChangeRef.current?.(newBgUrl || newArtUrl);
    return {
      ...prev,
      track_name: data.trackName,
      artist_name: data.artistName ?? prev.artist_name,
      album_name: data.albumName ?? prev.album_name,
      playback_state: data.playbackState,
      position_ms: data.positionMillis,
      album_art_url: newArtUrl,
      bg_image_url: newBgUrl,
      next_album_art_url: null,
      next_bg_image_url: null,
    };
  });
  fetchNowPlaying();
}
```

2. Samma mönster i 5s-pollingens trackChange-hantering (runt rad 215-232) -- om den detekterar ett spårbyte bör den också swappa bilder direkt.

Det är allt -- inga andra filer behöver ändras. Bakgrundsbilden finns redan i browser-cachen tack vare preload-elementen, så CSS `background-image` bör visa den omedelbart.
