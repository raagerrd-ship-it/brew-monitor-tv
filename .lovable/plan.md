

## Kritisk granskning av Sonos-integrationen

### Bugg 1 (KRITISK): `tokenData` refereras men existerar inte

**Fil:** `supabase/functions/sync-sonos-now-playing/index.ts`, rad 397

```
await supabase.from('sonos_tokens').update({ household_id: householdId }).eq('id', tokenData.id);
```

Variabeln `tokenData` finns inte langre i scope efter att token-logiken extraherades till `getValidAccessToken()`. Denna rad kraschar edge-funktionen nar ingen grupp ar vald och systemet forsoker auto-valja en. `tokenResult.tokenId` ska anvandas istallet.

**Fix:** Ersatt `tokenData.id` med `tokenResult.tokenId`

---

### Bugg 2: `prefetch_seconds` hamtas inte fran databasen i `useSonosInit`

**Fil:** `src/components/sonos/hooks/useSonosInit.ts`, rad 27-28 och 48

Init-hooken valjer `track_change_offset_seconds` i SQL-queryn men **inte** `prefetch_seconds`. Pa rad 48 lasas `settings?.prefetch_seconds` men vardet ar alltid `undefined` eftersom kolumnen aldrig efterfragas. Resultatet ar att ref:en alltid far fallback-vardet 30.

**Fix:** Lagg till `prefetch_seconds` i `.select()`-anropet pa rad 27.

---

### Bugg 3: `sonos-groups` anropas utan auth-headers

**Fil:** `src/components/sonos/SonosSettings.tsx`, rad 41

```ts
fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sonos-groups`)
```

Anropet saknar `Authorization`-header. Alla andra edge function-anrop inkluderar `Bearer`-token. Att detta fungerar idag beror pa att edge-funktionen inte validerar JWT — men det ar inkonsekvent och potentiellt osaker om JWT-validering nagonsin aktiveras.

**Fix:** Lagg till headers med `Authorization: Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`.

---

### Bugg 4: Stale `nowPlaying.playback_state` i tickern

**Fil:** `src/components/sonos/hooks/useSonosPlaybackTicker.ts`, rad 105

```ts
const isPlaying = nowPlaying.playback_state === 'PLAYBACK_STATE_PLAYING';
```

`nowPlaying` fangas i closure nar effekten skapas. Nar spelaren pausas andras `nowPlaying.playback_state` via `setNowPlaying`, men effekten tar **inte** om sig forran `playback_state` andras i dependency-arrayen (rad 174). Sa detta fungerar korrekt — men enbart for att `playback_state` ar med som dependency. Dock: nar en 5s-poll uppdaterar `playback_state` inom samma `track_name`, aterreras hela tickern onodigt.

**Bedomning:** Fungerar korrekt men fragilt. En enkel forbattring ar att lasa `playback_state` fran en ref istallet for closure.

---

### Problem 5: `PREFETCH_THRESHOLD_MS` exporteras men anvands aldrig

**Fil:** `src/components/sonos/hooks/types.ts`, rad 24

Konstanten `PREFETCH_THRESHOLD_MS = 30000` exporteras men anvands inte langre (tickern anvander nu `prefetchSecondsRef`). Dodkod som kan forvirra.

**Fix:** Ta bort exporten.

---

### Problem 6: `sonos-auth` disconnect saknar cleanup

**Fil:** `src/components/sonos/SonosSettings.tsx`, rad 103-116

Nar anvandaren kopplar bort Sonos rensas bara lokal React-state. `sonos_now_playing`-raden i databasen tas inte bort, och bakgrunds-prenumerationen (Realtime) fortsatter att peka pa gammal data. Nasta sidladdning kan visa en "spoke"-widget med gammal data tills cron-jobbet rensar.

**Fix:** Latt prioritet — losa genom att lagga till en databas-rensning i disconnect-edge-funktionen eller som ett extra client-anrop.

---

### Implementationsplan

| Prioritet | Fil | Andring |
|-----------|-----|---------|
| KRITISK | `sync-sonos-now-playing/index.ts` rad 397 | `tokenData.id` -> `tokenResult.tokenId` |
| HOG | `useSonosInit.ts` rad 27 | Lagg till `prefetch_seconds` i `.select()` |
| MEDEL | `SonosSettings.tsx` rad 41 | Lagg till auth headers pa `sonos-groups` fetch |
| LAG | `types.ts` rad 24 | Ta bort `PREFETCH_THRESHOLD_MS` |
| LAG | Ticker rad 105 | Valfritt: las `playback_state` fran ref |
| LAG | `SonosSettings.tsx` disconnect | Rensa `sonos_now_playing` vid disconnect |

