

## Analys

Du har rätt — `sonos-playback-status` frågar Sonos Cloud API direkt (inte via Cast Away), så positionen därifrån är **ground truth** utan Cast Away's latenskompensation eller 30s-fördröjning. Det är det mest exakta värdet för "tid kvar till låtbyte".

Idag är `PLAYBACK_POLL_INTERVAL = 0`, vilket gör att metadata-synken (rad 97: `if (!shouldSyncPlayback) return`) hoppas över — pollningen syncar bara position men ignorerar pause/track-change-detektering.

### Vad Cast Away fortfarande behövs för
- Album art, bakgrundsbilder, next-track art (bildpipeline)
- Track-seq monotonic gating
- Initial metadata vid uppstart

### Vad UPnP-pollen kan vara ensam källa för
- Position → countdown till låtbyte
- Pause/play-detektering
- Duration

## Plan

### Steg 1: Aktivera full 10s-poll
**Fil:** `src/components/sonos/hooks/types.ts`
- Ändra `PLAYBACK_POLL_INTERVAL` från `0` till `10000`
- Detta aktiverar metadata-synk (pause/play, track-change-detektering) i klient-pollen

### Steg 2: Ändra loggformat till countdown
**Fil:** `src/components/sonos/hooks/useSonosClientPolling.ts` (rad 90)
- Byt från elapsed till remaining:
```
📊 Sonos direkt — App: -138s | Sonos: -138s | Drift: +0.0s
```
- Beräkna `appRemaining = (duration - appPos) / 1000` och `sonosRemaining = (duration - sonosPos) / 1000`

### Steg 3: Prioritera UPnP-position för ticker
**Fil:** `src/components/sonos/hooks/useSonosRealtime.ts` (eller där Cast Away's position sätts)
- Behåll Cast Away's position som fallback, men låt 10s-pollens UPnP-position alltid överskriva — den är ground truth
- Tickern (`useSonosPlaybackTicker`) räknar redan ner från `localProgressRef` som snappas till UPnP var 10s

**Resultat:** UPnP-positionen blir ensam källa för nedräkning. Cast Away levererar fortfarande metadata/art. Loggen visar tydligt countdown till låtbyte och drift.

