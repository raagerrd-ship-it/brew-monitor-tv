

## Fix: Preview visar flera månader gammal version (PWA-cache)

### Orsak
PWA:ns Service Worker (Workbox) har cachat gamla JS/CSS/HTML-filer och serverar dem i preview. Utan `skipWaiting` och `clientsClaim` fastnar den gamla Service Workern och blockerar nya versioner.

### Losning — tva andringar

**1. `vite.config.ts`** — Lagg till `skipWaiting` och `clientsClaim`

I workbox-konfigurationen, lagg till dessa tva rader sa att en ny Service Worker tar over omedelbart istallet for att vanta:

```text
workbox: {
  skipWaiting: true,
  clientsClaim: true,
  globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
  runtimeCaching: [ ...befintlig config oforandrad... ]
}
```

**2. `src/hooks/use-version-check.ts`** — Forbattra reload-logiken

Uppdatera setTimeout-callbacken sa att den:
1. Hamtar aktiv SW-registrering
2. Om `registration.waiting` finns: skickar `SKIP_WAITING`-meddelande och vantar pa aktivering (max 3s timeout)
3. Sedan rensar cacher och laddar om som idag

### Paverkan
- Inga nya beroenden
- Inga nya filer
- Normal anvandning: ingen synlig forandring
- Efter publicering/rebuild: preview visar alltid senaste versionen direkt

