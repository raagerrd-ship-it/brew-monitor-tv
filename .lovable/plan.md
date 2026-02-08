

## Djupanalys av Sonos-integrationen -- Runda 4

### Sammanfattning

Koden ar nu i gott skick efter tre rundor. Denna granskning identifierar **3 konkreta problem** -- 1 stabilitetsproblem, 1 prestandarisk och 1 inkonsekvent beteende.

---

### Problem 1: `triggerServerSync()` saknar timeout

**Fil:** `src/components/sonos/hooks/types.ts`, rad 38-46

```ts
export function triggerServerSync(): void {
  fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-sonos-now-playing`, {
    method: 'POST',
    headers: { ... },
  }).catch(() => {});
}
```

Alla andra fetch-anrop i Sonos-integrationen anvander `AbortController` med 8-15s timeout for att forhindra att lågprestanda-TV-enheterna hangs vid natverksproblem. Men `triggerServerSync()` -- som anropas vid varje random skip (icke-sekventiellt latbyte) -- har ingen timeout alls. Pa Chromecast-hardvara kan ett stallande anrop blockera natverket och forsakra andra pollar.

**Fix:** Lagg till `AbortController` med 15s timeout (samma som prefetch-anropet).

---

### Problem 2: `imageError` aterstalls aldrig vid nytt spar

**Fil:** `src/components/sonos/SonosWidget.tsx`, rad 92

```ts
const isNewArtPending = incomingArtUrl && incomingArtUrl !== displayedArtUrl && !imageError;
```

Om en bild misslyckas (`onError` satter `imageError = true`) aterstalls aldrig `imageError` till `false` nar ett **nytt** spar byter in med en ny `album_art_url`. Resultatet ar att alla framtida bilder blockeras tills `handleNewImageLoaded` anropas (som aldrig hander eftersom `isNewArtPending` ar `false`). Widgeten fastnar pa den senast lyckade bilden for resten av sessionen.

**Fix:** Aterstall `imageError` till `false` nar `incomingArtUrl` andras till en ny URL. Enklast genom en `useEffect` som bevakar `incomingArtUrl`.

---

### Problem 3: Realtime-hookens position-uppdatering sker utanfor `setNowPlaying`

**Fil:** `src/components/sonos/hooks/useSonosRealtime.ts`, rad 79-82

```ts
if (incoming.position_ms != null) {
  localProgressRef.current = incoming.position_ms;
  updateProgressDOM(progressBarRef, debugTimeRef, incoming.position_ms, incoming.duration_ms);
}
```

Denna kod kors **alltid** -- aven om `setNowPlaying`-callbacken ovan returnerade `prev` (dvs ignorerade uppdateringen pa grund av cooldown eller spår-mismatch). Resultatet ar att `localProgressRef` och progress-baren kan hoppa till en position fran ett annat spar eller fran serverns foralldrade data under 15s-cooldown-perioden.

**Fix:** Flytta position-uppdateringen sa att den bara sker nar realtime-datan faktiskt accepteras. Returnera en flagga fran `setNowPlaying` callbacken (via en ref) eller flytta logiken inuti callbacken.

---

### Implementationsplan

| Prioritet | Fil | Andring |
|-----------|-----|---------|
| HOG | `types.ts` rad 38-46 | Lagg till `AbortController` med 15s timeout i `triggerServerSync()` |
| HOG | `SonosWidget.tsx` | Lagg till `useEffect` som aterstaller `imageError` vid ny `incomingArtUrl` |
| MEDEL | `useSonosRealtime.ts` rad 79-82 | Villkora position-uppdateringen pa att datan accepterades |

---

### Vad som nu ar bekraftat korrekt

Efter fyra granskningsrundor:

- Token-hantering: Konsoliderad, alla `await`
- Prefetch-installning: Hamtas korrekt fran DB, anvands via ref
- Client polling: Ingen stale closure, bakgrunds-safeguard med ref
- Realtime: 15s cooldown, sparmedveten filtrering
- Ticker: DOM-baserad progress, prediktiv polling, prefetch, early swap
- Auth headers: Konsekvent pa alla edge function-anrop
- Environment-variabler: Inga hardkodade URL:er kvar
- Disconnect: Full cleanup via edge function
- `isTvMode`: Skickas korrekt till widgeten

