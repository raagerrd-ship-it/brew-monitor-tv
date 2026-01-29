
# Plan: Ta bort popup för "Jäsning klar"

## Bakgrund
Popupen som visas i nedre högra hörnet med texten "Jäsningen är färdig (0.000/dag). Dags för Coldcrash!" triggas automatiskt när jäsningshastigheten sjunker under ett tröskelvärde.

## Aktuell implementation
- **Fil:** `src/hooks/use-brew-data.ts` (rad 483-498)
- **Villkor:** När `fermentationRate < 0.0005` och `coldcrashAcknowledged` är false
- **Åtgärd:** Visar en sonner toast-notifiering och uppdaterar databasen för att markera att meddelandet har visats

## Åtgärd
Ta bort eller kommentera bort koden som visar denna popup (rad 483-498).

### Teknisk ändring

**Fil: `src/hooks/use-brew-data.ts`**

Bort med följande kodblock:
```typescript
// Cold crash notification
if (
  newFermentationRate !== null &&
  Math.abs(newFermentationRate) < 0.0005 &&
  !brew.coldcrashAcknowledged
) {
  sonnerToast(`${updatedReading.name} är klar! 🍺`, {
    description: 'Jäsningen är färdig (0.000/dag). Dags för Coldcrash!',
    duration: 5000,
  });

  supabase
    .from('brew_readings')
    .update({ coldcrash_acknowledged: true })
    .eq('batch_id', brew.batch_id);
}
```

## Resultat
Ingen popup kommer längre visas när jäsningen bedöms vara klar. Användaren kan fortfarande se jäsningsstatus via dashboarden.
