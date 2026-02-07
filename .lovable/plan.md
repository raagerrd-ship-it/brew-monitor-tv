

# Smartare Sonos-latbyten med prediktiv timing

## Problem idag
Widgeten pollar var 5:e sekund for att upptacka latbyten. I varsta fall tar det 5 sekunder innan en ny lat visas. Progressionen tickar lokalt men har ingen aning om nar laten faktiskt tar slut.

## Losning
Anvand `duration_ms` och `position_ms` for att berakna exakt nar laten tar slut. Schemalagga en extra poll precis vid latslut (med liten marginal) for att hamta nasta lats metadata omedelbart.

```text
Nuvarande flode:
  |--5s--|--5s--|--5s--|--5s--|  (lat tar slut nagonstan mitt i ett intervall)
                         ^--- upptacker bytet har (upp till 5s sent)

Nytt flode:
  |--5s--|--5s--|--5s-|--|     (beraknar: 2s kvar)
                       ^--- schemalagd poll exakt vid latslut
```

## Tekniska andringar

### 1. SonosWidget.tsx - Prediktiv end-of-track poll

Lagg till en ny `useEffect` som:
- Beraknar `timeRemaining = duration_ms - localProgress`
- Om `timeRemaining` ar under 10 sekunder, schemalagger en `setTimeout` som pollar `sonos-playback-status` exakt nar laten borde ta slut (+ 500ms marginal)
- Nar pollet svarar med ny lat, uppdatera `nowPlaying` direkt
- Om den pollar och laten inte bytt an, forsoker igen efter 1 sekund (max 3 forsok)

### 2. SonosWidget.tsx - Skippa nasta vanliga 5s-poll efter prediktiv poll

Lagg till en ref `lastPredictivePollRef` som lagrar timestamp for senaste prediktiva poll. Den vanliga 5s-pollingen skippar sitt anrop om det var mindre an 3 sekunder sedan ett prediktivt poll.

### 3. useSonosTrackTransition.ts - Ingen andring

Hooken behover inte andras - den hanterar redan track updates korrekt.

## Sammanfattning av andringar

| Fil | Andring |
|-----|---------|
| `src/components/sonos/SonosWidget.tsx` | Ny useEffect for prediktiv timing + ref for att koordinera med 5s-poll |

Ingen serverandring behovs - all logik ar klientsida baserat pa data som redan finns.

