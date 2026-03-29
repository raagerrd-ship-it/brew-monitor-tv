
# Plan: Stoppa rollback till förra låten efter låtbyte i Sonos-widget

## Problembild (utifrån nuvarande kod)
Rollbacken sker sannolikt när lokalt/prediktivt låtbyte redan är gjort i klienten, men en fördröjd payload (RT eller polling) fortfarande rapporterar föregående låt.  
Nu finns skydd, men de är spridda och inte konsekventa i alla flöden (särskilt polling/ticker), så gammal data kan ibland vinna i några sekunder.

## Ändringar att bygga

1. **Inför en tydlig “anti-rollback lock” vid låtbyte**
   - När `handleTrackChange` byter från A → B, spara:
     - `fromTrack = A`
     - `toTrack = B`
     - `lockUntil = now + 15s`
   - Under lock-perioden får payloads som försöker sätta tillbaka A ignoreras.

2. **Använd samma lock i alla inkommande datakällor**
   - `useSonosRealtime.ts`: ignorera inkommande track som matchar `fromTrack` under aktiv lock.
   - `useSonosClientPolling.ts`: gör **early return före drift-korrigering** om payloaden är rollback-kandidat.
   - `useSonosPlaybackTicker.ts` (pollForNewTrack): om payload = `fromTrack` under lock, fortsätt retry istället för att kalla `handleTrackChange`.

3. **Rensa lock när backend bekräftar nya låten**
   - Om inkommande data matchar `toTrack` (eller lock-tid går ut), släpp locket.
   - Detta gör att legitima framtida byten fungerar normalt utan att blockeras.

4. **Hårda upp sekvensanvändning i polling-flöden**
   - Utnyttja `trackSeq` från `sonos-playback-status` även i klientpolling/ticker för extra monotont skydd.
   - Ignorera payloads med lägre seq än aktuell state.

5. **Backend-korrigering för seq-källa**
   - I `sonos-playback-status` hämta `track_seq` för **vald grupp** (`group_id`) istället för ospecificerad rad.
   - Minskar risk för fel seq-värde vid flera rader/gruppbyten.

## Filer som uppdateras
- `src/components/sonos/SonosWidget.tsx` (nya refs för rollback-lock, wiring till hooks)
- `src/components/sonos/hooks/useSonosTrackChange.ts` (sätta/hantera lock vid A→B)
- `src/components/sonos/hooks/useSonosRealtime.ts` (rollback-filter)
- `src/components/sonos/hooks/useSonosClientPolling.ts` (early return + seq-guard)
- `src/components/sonos/hooks/useSonosPlaybackTicker.ts` (retry istället för rollback vid lock)
- `supabase/functions/sonos-playback-status/index.ts` (group-scopad `track_seq`)

## Verifiering (end-to-end)
1. Byt låt manuellt nära låtslut och mitt i låt.
2. Bekräfta att widgeten **inte** går tillbaka till föregående låt under 15s-fönstret.
3. Bekräfta att den ändå återhämtar sig korrekt om prediktivt byte var fel (efter lock timeout).
4. Kontrollera att progressbar och bakgrund fortfarande syncar korrekt vid samma byten.

## Tekniska detaljer
- Ingen DB-migration behövs.
- Ingen UI-designändring behövs.
- Fokus är ren state/stream-konsistens mellan realtime, polling och prediktiv ticker.
