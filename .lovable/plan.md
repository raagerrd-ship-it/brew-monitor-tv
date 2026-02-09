
# Visa färgmarkeringar och tid kvar i Sonos-widgeten

## Vad som ska andras

Debug-indikatorerna (fargprickar for art-status och prefetch-status, samt tid kvar) ar redan implementerade i widgeten men doljs bakom `showDebug`-flaggan som defaultar till `false`. Istallet for att alltid visa dem via debug-flaggan, gor vi dem till en permanent del av widgeten.

## Andringar

### `src/components/sonos/SonosWidget.tsx`

1. **Ta bort `showDebug`-wrappern** runt indikatorerna (rad 275) sa att fargprickarna och tidsvisningen alltid renderas.

2. **Tid kvar** — debugTimeRef visar redan sekunder. Flytta den till en mer synlig plats (t.ex. bredvid progress-baren eller kvar uppe till hoger) och visa tid kvar i formatet `Xm Ys` istallet for bara `Xs`.

3. **Fargprickar** — behall dem som de ar (gron/orange/rod for art-status, gron/gul/orange for prefetch-status) men gora dem alltid synliga.

### Teknisk detalj

Tickern i `useSonosPlaybackTicker` uppdaterar redan `debugTimeRef` via DOM-manipulation (ingen re-render). Det enda som behovs ar att ta bort `showDebug &&`-villkoret i JSX:en sa att elementen alltid finns i DOM:en for ref-uppdateringarna.

Inget andras i hooks, inga nya beroenden, ingen databasandring.
