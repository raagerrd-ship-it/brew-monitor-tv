

## Plan: Eliminera Sonos Cloud API — 100% UPnP via Cast Away

### Bakgrund
Cast Away (UPnP-bridge) pushar redan **all data** till `sonos_now_playing` via `sonos-bridge-push`: latency-kompenserad position, metadata, state, volym, next-track. Trots det anropar 3 edge functions fortfarande Sonos Cloud API (`api.ws.sonos.com`), som kräver OAuth-tokens och har ~800ms latens.

### Vad som ändras

**1. `sonos-playback-status` → ren DB-read (~50ms istf ~800ms)**

Nuläge: Hämtar OAuth-token → anropar Sonos Cloud API för position + metadata → hämtar track_seq från DB.

Nytt: En enkel `select` från `sonos_now_playing`. Returnerar exakt samma response-format → **zero klientändringar**.

```text
Före:  Client → Edge Fn → Sonos Cloud API → response
Efter: Client → Edge Fn → DB select → response
```

**2. `sync-sonos-now-playing` → DB-only + image processing**

Nuläge: Hämtar OAuth-token → anropar Sonos Cloud API för metadata → kör image-processing.

Nytt: Läser metadata från `sonos_now_playing` (redan skriven av bridge-push) → kör bara image-processing (`resolveBackgroundAndWidget`) om bg saknas. `bg_only`-mode och pause-timeout-logiken behålls.

Två konsumenter: `triggerServerSync()` (image-fallback) och SonosSettings (bg-regenerering). Båda behöver bara image-processing, inte Sonos API.

**3. `sonos-groups` → kan tas bort**

Ingen konsument i klienten (`0 matcher`). Edge function anropas aldrig. Tas bort.

**4. `sonos-auth` → behåll `disconnect` + `status`, ta bort OAuth-flöde**

`disconnect` (rensar DB) och `status` (kolla om token finns) behålls för settings-UI. OAuth-flödet (`start` + `callback`) tas bort — bridgen behöver inget OAuth.

**5. Ta bort legacy-filer**
- `supabase/functions/_shared/sonos-token.ts` — ingen konsument kvar
- `supabase/functions/_shared/sonos-group-recovery.ts` — ingen konsument kvar
- `src/pages/SonosCallback.tsx` — OAuth callback-sida, ej längre relevant

### Klientändringar — inga
- `useSonosClientPolling` anropar `sonos-playback-status` → samma response-format
- `useSonosPlaybackTicker` anropar `sonos-playback-status` → samma response-format
- `triggerServerSync()` anropar `sync-sonos-now-playing` → samma funktion, bara utan Cloud API
- `fetchPlaybackStatus()` i types.ts → samma format

### Sammanfattning

| Fil | Åtgärd |
|---|---|
| `sonos-playback-status/index.ts` | Skriv om: DB-read |
| `sync-sonos-now-playing/index.ts` | Skriv om: ta bort Sonos API, behåll image-processing |
| `sonos-groups/index.ts` | Ta bort |
| `sonos-auth/index.ts` | Behåll `disconnect` + `status`, ta bort OAuth (`start`/`callback`) |
| `_shared/sonos-token.ts` | Ta bort |
| `_shared/sonos-group-recovery.ts` | Ta bort |
| `src/pages/SonosCallback.tsx` | Ta bort (+ ta bort route i App.tsx) |

### Resultat
- **0 anrop till Sonos Cloud API**
- ~50ms poll istf ~800ms
- Inga OAuth-tokens att refresha
- Inga Sonos rate limits
- Bridgen är SSOT — precis som tänkt

