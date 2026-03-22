

## Optimera Phase 2a: Eliminera onödigt RAPT Telemetri-anrop

### Insikt
Phase 1 hämtar redan pillens senaste gravity, temperature och battery via `GetHydrometers` och sparar i `rapt_pills`. Phase 2a anropar sedan **ett helt annat API** (`GetTelemetry`) för att hämta historiska datapunkter — men vid snabb-synk (var 5:e min) behöver vi bara **appenda den enda nya datapunkten** som redan finns i `rapt_pills`.

### Nuvarande flöde (onödigt)
```text
Phase 1: GetHydrometers → rapt_pills (gravity, temp, battery) ✅
Phase 2a: GetTelemetry → hämtar SAMMA data igen som historik  ❌ ~1-3s per pill
```

### Optimerat flöde
```text
Phase 1: GetHydrometers → rapt_pills (gravity, temp, battery) ✅
Phase 2a: Läs rapt_pills från minnet → appenda en datapunkt till sg_data ✅ ~0ms
```

`GetTelemetry` behövs bara vid:
- **Initial sync** (när `sg_data` är tom) — hämta hela historiken
- **Full sync** (var 6:e timme) — fånga eventuellt missade datapunkter

### Ändringar i `sync-rapt-data-quick/index.ts`

**`customBrewSync` funktion (rad 556-708):**

1. **Ersätt `fetchPillTelemetryCorrected`** med en enkel append av senaste datapunkt från Phase 1:s `rapt_pills`-data (redan tillgänglig via `fetchedPills` i scope)
2. **Behåll telemetri-fetch enbart** om `sg_data` är tom (initial sync) — då behövs historik
3. **Ta bort redundanta DB-queries** (rad 567-570) — använd `fetchedPills` och `controllerUpdatesForHistory` från Phase 1 istället
4. **Parallellisera** eventuella kvarvarande initial-sync telemetri-hämtningar med `Promise.all`

### Detaljerad logik för quick-append

```text
För varje custom brew:
  1. Hitta pill via linked_pill_id / paired_device_id (befintlig logik)
  2. Om sg_data är tom → hämta telemetrihistorik (GetTelemetry) som idag
  3. Om sg_data har data → läs pill.gravity + pill.temperature från Phase 1
     → Skapa en ny SgDataPoint { date: pill.last_update, value: gravity/1000, temp }
     → Appenda till sg_data (dedup på date)
     → Uppdatera brew_readings med ny sg_data + current_sg + current_temp etc.
```

### SG-korrektion
- Vid quick-append: applicera `applySgCorrection` på den enda datapunkten (om enabled)
- Vid initial-sync: befintlig logik med `fetchPillTelemetryCorrected` behålls

### Uppskattad besparing
- **~1500-3000ms** per cykel (eliminerar 1-2 externa API-anrop)
- Phase 2a bör gå från ~3700ms till ~200-500ms

### Fil
- `supabase/functions/sync-rapt-data-quick/index.ts` — refaktorera `customBrewSync`

