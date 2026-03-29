

# Förenklad anti-rollback: monoton seq-gate

## Problem
Nuvarande skydd har tre överlappande mekanismer (`RollbackLock`, `trackChangedAtRef` 15s-cooldown, `track_seq`-check) som inte samverkar. Rollback-locket löper ut efter 15s och gammal data kan då vinna. Dessutom saknas seq-gate i polling och ticker.

## Ny design: en enda gate

Ersätt `RollbackLock` + `trackChangedAtRef`-cooldowns med **en enda ref `acceptedSeqRef`** som aldrig minskar.

```text
Flöde:
1. Backend skriver track_seq = N vid ny låt
2. Klienten accepterar data om incoming.seq >= acceptedSeqRef
3. Vid prediktivt byte: klienten sätter acceptedSeqRef = currentSeq + 1
   → all data med gamla seq:n blockeras automatiskt
4. Backend bekräftar med seq = N+1 → klienten accepterar
```

### Regler för alla datakällor (RT, polling, ticker):
- **Seq-gate**: `incoming.track_seq < acceptedSeqRef` → ignorera helt
- **Samma låt-namn + samma/högre seq** → uppdatera state/art/position
- **Ny låt + högre seq** → acceptera låtbyte
- **Ny låt + samma seq** → ignorera (backend har inte bekräftat ännu)

### Vid prediktivt byte (ticker):
- `acceptedSeqRef.current = (currentSeq ?? 0) + 1`
- Kör `handleTrackChange` som vanligt
- All gammal data blockeras automatiskt tills backend skriver ny seq

## Ändringar

### 1. `types.ts`
- Ta bort `RollbackLock`, `isRollbackBlocked`, `shouldClearLock`
- Behåll resten

### 2. `SonosWidget.tsx`
- Ersätt `rollbackLockRef` med `acceptedSeqRef = useRef<number>(0)`
- Ta bort `trackChangedAtRef` (behövs inte längre)
- Skicka `acceptedSeqRef` till alla hooks istället

### 3. `useSonosInit.ts`
- Hämta `track_seq` i init-queryn
- Sätt `acceptedSeqRef.current = data.track_seq` vid uppstart

### 4. `useSonosRealtime.ts`
- Ersätt rollback-lock + trackChangedAt-cooldown med enkel seq-gate:
  ```
  if (incoming.track_seq < acceptedSeqRef.current) return prev;
  ```
- Vid track change: `acceptedSeqRef.current = incoming.track_seq`
- Ta bort 15s-cooldown-logik (rad 97-98)

### 5. `useSonosClientPolling.ts`
- Hämta `trackSeq` från polling-response (redan returneras av backend)
- `if (trackSeq < acceptedSeqRef.current) return;` — early return före all annan logik
- Ta bort rollback-lock-checks och `msSinceTC >= 15000`-guards
- Vid track change via polling: trigga server sync (som idag), men låt seq-gaten hantera skyddet

### 6. `useSonosPlaybackTicker.ts`
- Vid prediktivt byte: `acceptedSeqRef.current = (nowPlaying.track_seq ?? 0) + 1`
- Ta bort rollback-lock-checks i `pollForNewTrack`
- Använd seq-gate: om polled `trackSeq < acceptedSeqRef` → retry

### 7. `useSonosTrackChange.ts`
- Ta bort rollback-lock-logik helt
- Behåll allt annat (DOM-swap, image-hantering)

### 8. `sonos-playback-status` (backend)
- Redan fixad att hämta `track_seq` per `group_id` — ingen ändring behövs

## Filer

| Fil | Ändring |
|-----|---------|
| `src/components/sonos/hooks/types.ts` | Ta bort RollbackLock, isRollbackBlocked, shouldClearLock |
| `src/components/sonos/SonosWidget.tsx` | `acceptedSeqRef` ersätter `rollbackLockRef` + `trackChangedAtRef` |
| `src/components/sonos/hooks/useSonosInit.ts` | Hämta `track_seq`, sätt `acceptedSeqRef` |
| `src/components/sonos/hooks/useSonosRealtime.ts` | Enkel seq-gate istället för lock+cooldown |
| `src/components/sonos/hooks/useSonosClientPolling.ts` | Seq-gate, ta bort lock-checks |
| `src/components/sonos/hooks/useSonosPlaybackTicker.ts` | Bumpa seq vid prediktivt byte, seq-gate i poll |
| `src/components/sonos/hooks/useSonosTrackChange.ts` | Ta bort lock-logik |

## Resultat
- En enda mekanism istället för tre
- Inget timeout-problem (seq löper aldrig ut)
- Prediktivt byte fungerar fortfarande (bumpar seq lokalt)
- Backend-bekräftelse via seq garanterar att gammal data aldrig vinner

