

# Fix: Golv-erosion fastnar i EMA-loop (Blå controller)

## Problemet
Erosionskoden i `pid-compensation.ts` beräknar redan ett utjämnat nytt golvvärde (`integral * 0.3 + ssFloor * 0.7`), kvantiserar det nedåt till 10%-steg med `Math.floor`, och skickar sedan resultatet till `updateLearnedParam` med `alpha=0.5`. Men `updateLearnedParam` applicerar **ytterligare en EMA** ovanpå, vilket gör att steget (t.ex. 0.41 → 0.40) halveras till 0.405 och avrundas tillbaka till 0.41. Golvet kan aldrig sjunka.

## Lösning
Ändra `alphaOverride` från `0.5` till `1.0` i erosionsanropet. Erosionen har redan sin egen utjämning (70/30 blend), så den behöver inte ytterligare EMA-smoothing vid sparning. Med `alpha=1.0` skrivs det beräknade värdet direkt.

## Ändring

**Fil: `supabase/functions/_shared/pid-compensation.ts`** (rad 272)

Ändra:
```typescript
await updateLearnedParam(supabase, controllerId, `steady_state_duty:${ssBucket}`, quantizedFloor, 0, 1.0, 0.5)
```
Till:
```typescript
await updateLearnedParam(supabase, controllerId, `steady_state_duty:${ssBucket}`, quantizedFloor, 0, 1.0, 1.0)
```

En ändring, en rad. Golvet kommer nu kunna sjunka med ett 10%-steg per overcooled-cykel (t.ex. 0.41 → 0.40 → 0.30 efter fler cykler om behovet kvarstår).

