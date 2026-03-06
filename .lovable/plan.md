

## Problem

Gap-positioneringen blir fel vid utskrift — även vid en enda kopia. Etiketten skrivs ut men pappret stannar inte rätt vid nästa gap.

## Orsak

I `sendRasterJob` skickas `Form Feed` (0x0c) **efter** en 3-sekunders väntan (rad 488-491):

```text
... raster data skickas ...
→ delay(3000)        ← skrivaren har redan börjat mata papper
→ Form Feed (0x0c)   ← kommer för sent, skrivaren har redan passerat gapet
→ end-job
```

Skrivaren börjar mata papper så fort rasterdatan är klar. Om form-feed-kommandot (som triggar gap-sökning) kommer **efter** att pappret redan rört sig, hamnar stoppositionen fel.

## Fix

**Fil: `src/lib/thermal-printer.ts`** — `sendRasterJob`

1. Flytta `Form Feed` (0x0c) till **direkt efter** sista raster-chunken, innan den långa väntan
2. Lägg den stora delayen (3s) **efter** form feed, så skrivaren hinner söka gap och stanna
3. Sedan end-job + ACK som vanligt

Ny ordning:
```text
... raster data skickas ...
→ delay(200)         ← kort paus så skrivaren hinner ta emot sista chunk
→ Form Feed (0x0c)   ← triggar gap-sökning medan pappret matas
→ delay(3000)        ← vänta tills skrivaren stannat vid gapet
→ end-job + ACK
```

