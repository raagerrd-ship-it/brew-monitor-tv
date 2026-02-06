

## Ta bort VitePWA — behall automatisk TV-uppdatering

### Vad tas bort

**1. `vite.config.ts`**
- Ta bort `import { VitePWA } from 'vite-plugin-pwa'`
- Ta bort hela `VitePWA({...})`-blocket fran plugins

**2. `package.json`**
- Ta bort `vite-plugin-pwa` fran dependencies

### Vad behalles (oforandrat)

**`src/hooks/use-version-check.ts`** — Pollar `index.html` var 60:e sekund, jamfor resurshasharna, och gor hard reload med cache-rensning nar en ny version detekteras. Fungerar helt utan Service Worker.

**`index.html`** — Emergency cleanup-scriptet som rensar kvarvarande gamla Service Workers vid forsta laddning.

**`src/main.tsx`** — SW-unregister for TV-mode och `controllerchange`-lyssnaren som sakerhet.

### TV-uppdateringsflode efter andringen

```text
useVersionCheck (var 60s)
  |
  +-- Hamtar /?_=timestamp (cache-busted)
  |
  +-- Jamfor script/CSS-hashar
  |
  +-- Om ny version:
        1. Visar toast "Ny version tillganglig"
        2. Vantar 2s
        3. Rensar ev. kvarvarande SW-cacher
        4. Hard reload med cache-busting parameter
```

### Sammanfattning
- Tre andringar: `vite.config.ts` (ta bort plugin), `package.json` (ta bort dependency), inget annat
- TV:n fortsatter uppdatera sig automatiskt via `useVersionCheck`
- Ingen offline-funktionalitet pga borttagning av SW, men det anvands inte

