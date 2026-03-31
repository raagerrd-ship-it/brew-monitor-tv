

## Cache genererade Sonos-bakgrunder (LRU, max 200)

### Vad
Lägg till cache-check i `resolveBackground` så att redan genererade bakgrunder återanvänds. Ändra cleanup från "radera allt utom current+next" till LRU med max 200 filer.

### Ändringar

**`supabase/functions/_shared/sonos-storage.ts`**

1. **`resolveBackground`** — Före fetch+process, kolla om `bgFileName` redan finns i bucketen via `storage.list()`. Om ja, returnera public URL direkt. Skippa check om `_forceRegenerate === true`.

2. **`cleanupUnreferencedBackgrounds`** — Sortera alla filer på `updated_at` fallande, behåll de 200 senaste + bridge-filer + explicit refererade URLs. Radera resten.

### Tekniska detaljer

- Filnamn inkluderar settings-hash + version, så cache invalideras automatiskt vid ändrade inställningar
- ~200 filer × ~50KB ≈ 10MB — försumbart
- Inga databas- eller frontend-ändringar krävs
- Bara en fil ändras

