

## Fix: Bakgrundskontroll i 5s-pollen

### Problem
Bakgrunden kan saknas om `bg_image_url` inte finns i databasen vid första laddning, eller om `onAlbumArtChange` missas vid initialt bildladdning. Widgeten visar albumbilden korrekt (prick 1 gron) men bakgrunden forblir svart.

### Losning
Lagg till en enkel kontroll i slutet av 5s poll-funktionen: om widgeten har en visad bild (`displayedArtUrl`) men foraldrakomponenten inte har fatt nagon bakgrund, skicka den. 

Vi anvander en ref (`bgSentRef`) for att spara om bakgrund har skickats, sa att kontrollen bara triggar en gang (eller om URL:en andras). Ingen ny useEffect, inget extra natverk — bara en enkel if-sats i befintlig poll-loop.

### Tekniska detaljer

**`src/components/sonos/SonosWidget.tsx`**

1. Lagg till en ny ref for att tracka senast skickade bakgrunds-URL:

```typescript
const bgSentRef = useRef<string | null>(null);
```

2. Uppdatera `handleNewImageLoaded` och alla `onAlbumArtChangeRef.current?.(...)` anrop for att aven satta `bgSentRef.current`.

3. I slutet av 5s poll-funktionen (efter all befintlig logik, rad ~290), lagg till:

```typescript
// Safeguard: if widget shows art but background hasn't been sent, send it now
const currentArt = displayedArtUrl;
if (currentArt && bgSentRef.current !== currentArt) {
  const bgUrl = nowPlaying?.bg_image_url || currentArt;
  onAlbumArtChangeRef.current?.(bgUrl);
  bgSentRef.current = currentArt;
}
```

4. Nollstall `bgSentRef.current` i `shouldHide`-effecten nar bakgrunden rensas.

### Alternativ (annu enklare)
Om vi inte vill tracka med en ref kan vi helt enkelt skicka bakgrunden varje poll-cykel — `onAlbumArtChange` i foraldrakomponenten bor redan vara idempotent (satts till samma URL = ingen re-render). Da blir det bara:

```typescript
// End of poll function
if (displayedArtUrl) {
  onAlbumArtChangeRef.current?.(nowPlaying?.bg_image_url || displayedArtUrl);
}
```

Jag rekommenderar det enklare alternativet (utan ref) — om foraldrakomponenten hanterar duplicerade anrop korrekt ar det bara en rad extra kod. Men om det visar sig orsaka onodiga re-renders kan vi lagga till ref-losningen.
