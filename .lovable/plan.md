

## Visa cache-status + genererings/laddtid i TV-loggen, ta bort "Laddar bakgrund"-meddelandet

### Översikt
Propagera `cached`-flagga och `bg_generation_ms` från edge functions till klienten via `sonos_now_playing`. Visa i preload-loggen och vid låtbyten. Ta bort den redundanta "⏳ Laddar bakgrund"-loggen i `use-album-art-background.ts`.

### Ändringar

**1. DB-migration** — Lägg till 4 kolumner på `sonos_now_playing`:
```sql
ALTER TABLE sonos_now_playing
  ADD COLUMN bg_cached boolean DEFAULT null,
  ADD COLUMN next_bg_cached boolean DEFAULT null,
  ADD COLUMN bg_generation_ms integer DEFAULT null,
  ADD COLUMN next_bg_generation_ms integer DEFAULT null;
```

**2. `supabase/functions/_shared/sonos-storage.ts`** — Ändra `resolveBackground` returtyp:
- Returnera `{ bgUrl, cached, generationMs }` istället för `{ bgUrl }`
- Cache hit: `cached: true`, `generationMs: 0`
- Nygenerad: `cached: false`, `generationMs` = tid för fetch+process+upload

**3. `supabase/functions/sonos-bridge-push/index.ts`** — Spara cache-data:
- Läs `result.cached`, `result.generationMs` från `resolveBackground`
- Sätt `bg_cached`, `bg_generation_ms`, `next_bg_cached`, `next_bg_generation_ms` i `imageUpdate`

**4. `supabase/functions/sync-sonos-now-playing/index.ts`** — Samma:
- Spara `bg_cached` och `bg_generation_ms` vid bg-generering

**5. `src/components/sonos/hooks/useSonosPlaybackTicker.ts`** — Preload-loggen (rad 133):
- Läs `current?.bg_cached` / `current?.next_bg_cached` och `next_bg_generation_ms`
- Ändra loggen till: `🖼️ Preload 1 bild(er) 11.6s innan slut (sparad)` eller `(genererad 850ms)`

**6. `src/components/sonos/hooks/useSonosRealtime.ts`** — RT-loggar:
- Vid track change (rad 120): inkludera `(sparad)` / `(genererad Xms)` från `incoming.bg_cached` och `incoming.bg_generation_ms`
- Vid next-preload (rad 159): visa cache-status

**7. `src/components/sonos/hooks/useSonosTrackChange.ts`** — Track change-logg:
- Vid `hasPreloaded` (tvDebug rad): visa cache-status

**8. `src/hooks/use-album-art-background.ts`** — Ta bort `⏳ Laddar bakgrund`-loggen:
- Ta bort `tvDebug('bg', '⏳ Laddar bakgrund för...')` på rad 28
- Behåll `✅`/`❌`/`⏭️`-loggarna (de visar browser-preload-status, inte server-generering)

### Tekniska detaljer
- `bg_cached`/`next_bg_cached`: nullable boolean, `null` = okänt (gamla rader)
- `bg_generation_ms`/`next_bg_generation_ms`: nullable integer, millisekunder
- Klienten läser fälten direkt via realtime payload (inga typändringar behövs manuellt)
- `resolveBackground` mäter tid med `Date.now()` före/efter fetch+process+upload

