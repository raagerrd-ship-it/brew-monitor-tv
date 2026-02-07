

## Adaptiv bakgrundsljusstyrka for Sonos-bakgrundsbilder

### Problem
Idag appliceras ljusstyrkan som en fast procentsats ("reduce brightness to 40%") oavsett hur ljus originalbilden ar. Det gor att ljusa albumomslag ser bra ut, men morka omslag blir nastan helt svarta.

### Losning
Andra AI-prompten i `sync-sonos-now-playing` sa att den instrueras att analysera bildens faktiska ljusniva och justera adaptivt. Malet ar att den fardiga bilden alltid landar pa ungefar samma upplevda ljusniva -- en ljus bild morklaggs mer, en redan mork bild justeras mindre.

### Tekniska detaljer

**`supabase/functions/sync-sonos-now-playing/index.ts`**

I funktionen `generateBackground` (rad 78-137), andra prompten fran:

```text
Apply a Gaussian blur of {blur}px and reduce brightness to {brightnessPercent}%.
```

Till:

```text
Apply a Gaussian blur of {blur}px. Analyze the image's overall brightness and 
adjust it so the final output has an average perceived brightness of approximately 
{brightnessPercent}% of maximum. Bright images should be darkened significantly, 
while already dark images should be darkened less or not at all. The goal is a 
consistent output brightness regardless of the input. Scale to 1280x720. Output as JPEG.
```

Dessutom andras cache-nyckeln (rad 224) sa att `brightness`-vardet ingar i filnamnet. Detta ar redan fallet (`${hash}-${blur}-${Math.round(brightness * 100)}.jpg`), sa befintliga cachade bilder med den gamla prompten kommer automatiskt att genereras om nar anvandaren andrar ljusstyrka -- men for att tvinga omgenerering aven vid samma varde behover vi lagga till en versionstagg i filnamnet, t.ex. `${hash}-${blur}-${Math.round(brightness * 100)}-v2.jpg`.

**Sammanfattning av andringar:**
- En fil andras: `supabase/functions/sync-sonos-now-playing/index.ts`
- Prompten i `generateBackground` skrivs om for adaptiv ljusstyrka
- Cache-filnamnet far en versionstagning (`-v2`) for att invalidera gamla bilder

