

## Fix: Prefetch-pricken blir gron vid tidig bildvaxling

### Problem
Nar early swap triggas (bilden byts X sekunder innan latslut) satts `next_album_art_url` till `null` i state. Det gor att det dolda `<img>`-elementet som lyssnar pa `onLoad` aldrig renderas, och prefetch-statusen fastnar pa gul (`ready`) istallet for att bli gron (`loaded`).

Bilden visas korrekt -- det ar bara statusindikatorn som inte uppdateras.

### Losning
Satt `prefetchStatus` till `'loaded'` nar early swap gors, precis efter att `earlySwapDoneRef` markeras som true. 

### Tekniska detaljer

**`src/components/sonos/SonosWidget.tsx`** (rad ~165)

I early swap-blocket, efter `earlySwapDoneRef.current = true`, lagg till:

```typescript
setPrefetchStatus('loaded');
```

Det ar en enradsandring. Effekten ar att pricken gar fran gul till gron i samma ogonblick som bilden faktiskt visas, vilket korrekt speglar att tillgangarna har laddats och anvands.
