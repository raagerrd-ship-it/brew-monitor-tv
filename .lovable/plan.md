

# Normaliserad ljusstyrka for Sonos-bakgrunder

## Problem
Nuvarande ljusstyrka-slider multiplicerar varje pixel med ett fast värde (t.ex. 0.35). En mörk albumomslag-bild blir extremt mörk medan en ljus bild fortfarande kan vara relativt ljus. Resultatet varierar kraftigt mellan låtar.

## Lösning
Ersätt den enkla multiplikatorn med en **luminans-normalisering** i två steg:

1. **Mät** bildens genomsnittliga luminans (0-255) efter blur
2. **Skala** varje pixel så att genomsnittet matchar sliderns målvärde

Slidern anger då en **absolut mål-luminans** istället för en relativ faktor. Oavsett om albumomslaget är svart eller vitt kommer bakgrunden att landa på samma ljusnivå.

## Tekniska detaljer

### Fil: `supabase/functions/_shared/image-processing.ts`

**Ny funktion** `measureAverageLuminance`:
- Loopar genom alla pixlar och beräknar luminans med formeln `0.299*R + 0.587*G + 0.114*B`
- Returnerar medelvärdet (0-255)

**Ändrad funktion** `applyColorAdjustments`:
- Steg 1: Beräkna genomsnittlig luminans
- Steg 2: Om genomsnittet > 0, beräkna en skalfaktor = `targetLuminance / avgLuminance`
- Steg 3: Applicera skalfaktorn istället för den fasta brightness-multiplikatorn
- Contrast och saturation appliceras efter normalisering, precis som idag

`brightness`-värdet i `BgSettings` tolkas om: istället för en multiplikator (t.ex. 0.35) blir det en mål-luminans i intervallet 0-255. Standardvärdet 90 (~35% av 255) ger ungefär samma visuella resultat som nuvarande 0.35.

**Uppdatering av cache-nyckel**: Eftersom beteendet ändras bumpas versionen i `sonos-storage.ts` filnamn från `v7` till `v8` så att alla bakgrunder genereras om med den nya logiken.

### Fil: `src/components/sonos/SonosSettings.tsx`

Slidern för ljusstyrka uppdateras:
- Intervall: 0-255 (istället för 0-100 som mappas till 0.0-1.0)
- Standardvärde: 90
- Etikett visar det absoluta värdet

### Fil: `supabase/functions/sync-sonos-now-playing/index.ts`

Uppdatera default-värdet för `bg_brightness` från `0.35` till `90`.

### Databaskolumn

Kolumnen `bg_brightness` i `sonos_settings` behåller sin typ (`numeric`) men värdet tolkas nu som 0-255 istället för 0.0-1.0. En migration sätter standardvärdet till 90 och konverterar eventuellt befintligt värde (om det är < 1, multiplicera med 255).
