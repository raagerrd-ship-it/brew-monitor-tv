

## Fix: Ta bort reload-logiken från emergency SW cleanup

### Problem
Emergency cleanup-scriptet i `index.html` gör `location.reload()` om det hittar en gammal Service Worker. I Lovable-previewen kan detta orsaka att gammal version visas eller att sidan laddar om i onödan.

### Ändring

**`index.html`** — Förenkla cleanup-scriptet till att bara rensa SWs och cacher, utan reload:

```html
<script>
  if('serviceWorker' in navigator){
    navigator.serviceWorker.getRegistrations().then(function(regs){
      regs.forEach(function(r){r.unregister()});
      if('caches' in window){caches.keys().then(function(n){n.forEach(function(c){caches.delete(c)})})}
    });
  }
</script>
```

Borttaget:
- `hadSW`-variabeln
- `sessionStorage`-flaggan (`sw_cleared`)
- `location.reload()`-anropet

### Varför det fungerar
- Inga nya SWs genereras (VitePWA borta)
- Kvarvarande gamla SWs rensas tyst vid nästa laddning
- `useVersionCheck` hanterar versionskontroll och reload separat
- Ingen risk för reload-loop i preview/iframe
