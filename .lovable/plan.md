
## Ta bort header-bakgrund i TV-läge och lägg till mörk fade i AI-genererad bakgrundsbild

### Vad ändras

**1. Headern i TV-läge blir transparent**
- Bakgrundsfärgen och kantlinjen (border-bottom) tas bort i TV-läge när albumkonst visas
- Den subtila ljuslinjen i toppen tas också bort
- Headerns innehåll (logo, RAPT-panel, klocka) flyter direkt ovanpå bakgrundsbilden

**2. AI-prompten uppdateras för mörk fade i ovankant**
- Prompten i edge-funktionen `sync-sonos-now-playing` får ett tillägg som instruerar AI:n att applicera en mörk gradient-fade i bildens övre ~15%, så att header-text och ikoner alltid är läsbara utan separat bakgrund

### Tekniska detaljer

**`src/components/DashboardHeader.tsx`**
- Ändra `background` i style-objektet: när `isTvMode && hasAlbumArtBackground` sätts bakgrunden till `'transparent'` istället för den halvgenomskinliga färgen
- Ta bort `borderBottom` i TV-läge med albumkonst
- Dölj den subtila top-highlight-linjen i TV-läge

**`supabase/functions/sync-sonos-now-playing/index.ts`**
- Uppdatera AI-prompten (rad ~112) med instruktion att lägga till en mjuk mörk gradient i bildens övre del:

```
"...Also apply a subtle dark gradient fade at the top ~15% of the image,
going from about 60% black opacity to fully transparent, to ensure
text readability when overlaid."
```

Notera: Befintliga cachade bakgrunder (med `-v2.jpg`-suffix) kommer inte att uppdateras automatiskt. Nya låtar får den nya stilen direkt. Vid behov kan cachen rensas manuellt via storage.
