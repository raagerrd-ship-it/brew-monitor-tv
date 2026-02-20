
# Ytterligare optimeringar

## 1. Dubbel Realtime-kanal for cached_external_timer (MEDIUM impact)

`use-external-timer.ts` skapar en egen Realtime-kanal (`cached-timer-changes`) som lyssnar pa `cached_external_timer` (rad 275-289). Samtidigt lyssnar `use-brew-data.ts` redan pa samma tabell via sin config-updates-kanal (rad 638) och anropar `onCachedTimerChange.current?.()` -- som pekar tillbaka till samma `fetchFromCache` i `use-external-timer.ts` (rad 272).

Det innebar TVA Realtime-kanaler for samma tabell som gor exakt samma sak.

**Fix:** Ta bort den egna kanalen i `use-external-timer.ts` (rad 275-289). Behall bara callback-mekanismen via `onCachedTimerChange` som redan fungerar via `use-brew-data.ts`.

## 2. Oanvand use-realtime-subscription.ts (LOW impact, stadning)

`useRealtimeSubscription` och `useMultiTableRealtime` anvands inte langre nagonstandans i kodbasen -- all Realtime hanteras nu via konsoliderade kanaler i `use-brew-data.ts`. Filen kan tas bort for att minska kodbasen.

**Fix:** Ta bort `src/hooks/use-realtime-subscription.ts`.

## 3. Timer sync kors aven nar Sonos ar IDLE och ingen timer ar aktiv (LOW impact)

`triggerSync` anropar edge function `sync-external-timer` aven i slow mode (var 30:e sekund). Nar timern ar inaktiv och ingen extern timer kors, ar detta onodigt. Initialt fetch + Realtime racker -- polling behovs bara som fallback.

**Fix:** Lagg till en check i `triggerSync` som bara anropar edge function om `isActiveRef.current === true`, eller vid forsta anropet. I slow mode, anvand bara DB-poll (skippa edge function-synken helt).

---

## Tekniska detaljer

### Fil: `src/hooks/use-external-timer.ts`
- Ta bort rad 275-289 (kanal `cached-timer-changes` samt subscribe/cleanup)
- Behall `onCachedTimerChangeRef.current = () => fetchFromCache()` (rad 272) -- den anvands av `use-brew-data.ts` redan
- I `setupIntervals`: nar `active === false`, skippa `triggerSync`-intervallet helt (satt bara poll-intervall). Edge function behovs bara nar timer ar aktiv.

### Fil: `src/hooks/use-realtime-subscription.ts`
- Ta bort hela filen (oanvand)

### Forvantad effekt
- En farre Realtime-kanal (3 istallet for 4 totalt)
- Eliminerar edge function-anrop var 30:e sekund nar ingen timer ar aktiv
- Renare kodbas utan dead code
