

## Djupanalys av Sonos-integrationen -- Runda 3

### Sammanfattning

Koden ar betydligt renare efter de tva foregaende rundorna. Denna granskning hittar **4 konkreta problem** -- 1 bugg, 2 inkonsekvenser och 1 sakerhetsrisk.

---

### Problem 1: Hardkodad Supabase-URL i SonosCallback

**Fil:** `src/pages/SonosCallback.tsx`, rad 33

```
`https://plwchuzidrjgyuepwdcl.supabase.co/functions/v1/sonos-auth?action=callback&code=${encodeURIComponent(code)}`
```

Samma typ av problem som fixades i SonosSettings -- en hardkodad URL istallet for `import.meta.env.VITE_SUPABASE_URL`. Dessutom saknas `Authorization`-header pa anropet.

**Fix:** Ersatt med `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sonos-auth?action=callback&code=...` och lagg till auth-header.

---

### Problem 2: `isTvMode` skickas aldrig till SonosWidget

**Fil:** `src/components/BrewingDashboard.tsx`, rad 432

```tsx
<SonosWidget isMobile={false} onAlbumArtChange={handleAlbumArtChange} onRealtimeRef={onSonosNowPlayingChange} showDebug />
```

Widgeten accepterar `isTvMode` som prop (rad 10 i SonosWidget.tsx) men BrewingDashboard skickar aldrig med det. Resultatet ar att `isTvMode` alltid ar `false` inne i widgeten. Idag anvands inte proppen for nagon logik inuti widgeten, sa det har ingen synlig effekt -- men det ar en tyst bugg som kan bli problematisk om TV-specifik logik laggs till i framtiden.

**Fix:** Skicka `isTvMode={isTvMode}` till SonosWidget.

---

### Problem 3: `handleConnect` saknar auth-header

**Fil:** `src/components/sonos/SonosSettings.tsx`, rad 89-91

```ts
const response = await fetch(
  `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sonos-auth?action=start`
);
```

Alla andra edge function-anrop i filen inkluderar `Authorization`-header, men `action=start` gor det inte. Samma inkonsekvent-monster som fixades for `sonos-groups` i forra rundan.

**Fix:** Lagg till `Authorization: Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` i headers.

---

### Problem 4: Dubbel delete av `sonos_now_playing` vid disconnect

**Fil:** `src/components/sonos/SonosSettings.tsx`, rad 107-120

Klienten gor tva parallella deletes av `sonos_now_playing`:
1. Edge-funktionen `sonos-auth?action=disconnect` (rad 181 i sonos-auth) tar bort raden fran databasen server-side
2. Klienten (rad 119) gor ocksa `(supabase as any).from('sonos_now_playing').delete().neq('id', '')`

Dessa konfliktar inte rent tekniskt, men klientens delete anvander `neq('id', '')` medan serverns anvander `neq('id', '00000000-...')`. Om tabellens RLS-policies eller id-format andras kan en av dem misslyckas tyst. Dessutom ar klientens anrop redundant nu nar edge-funktionen redan gor samma sak.

**Fix:** Ta bort den lokala klient-deleten -- lat edge-funktionen hantera all cleanup.

---

### Implementationsplan

| Prioritet | Fil | Andring |
|-----------|-----|---------|
| MEDEL | `SonosCallback.tsx` rad 33 | Ersatt hardkodad URL med env-variabel + lagg till auth-header |
| LAG | `BrewingDashboard.tsx` rad 432 | Lagg till `isTvMode={isTvMode}` pa SonosWidget |
| LAG | `SonosSettings.tsx` rad 89 | Lagg till auth-header pa `handleConnect` |
| LAG | `SonosSettings.tsx` rad 119 | Ta bort redundant klient-delete |

---

### Vad som nu fungerar korrekt

Efter tre granskningsrundor ar foljande bekraftat:

- **Token-hantering:** Konsoliderad i delad hjalpfil, alla edge functions anvander `await`
- **Prefetch-installning:** Hamtas fran databasen och anvands korrekt via ref
- **Client polling:** Ingen double-update, stale closure hanterad via nowPlayingRef
- **Realtime:** 15s cooldown, spårmedveten filtrering, bakgrundsbild-undantag
- **Ticker:** DOM-baserad progress, prediktiv polling, prefetch, early swap
- **Bakgrundssynk:** Rullande buffer, bassokvagskomparation, preload-mekanism
- **Visibility:** 5s grace period, korrekt PAUSED/IDLE-hantering
- **Edge functions:** Chunk-baserad base64, parallella API-anrop, timeout-hantering

