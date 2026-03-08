

## Analys: Snapshot-insamling idag

### Nuvarande komplexitet

`createBrewSnapshots` är onödigt komplex:

1. **Tar emot hela `sgData`-arrayen** (alla historiska SG-punkter), filtrerar bort redan sparade via paginated lookup mot `brew_data_snapshots`
2. **Hämtar controller-historik** via `get_temp_history_sampled` RPC för hela tidsintervallet
3. **Gör nearest-neighbor-matchning** (binärsökning) för att hitta controller-temp närmast varje SG-punkt
4. **Fallback** till `rapt_temp_controllers` live-state om ingen historik matchar

Resultatet: ~80 rader logik för att i praktiken bara spara "nuvarande värden". Dessutom skickas *alla* SG-punkter varje cykel, bara för att filtrera bort de som redan finns.

### Förenkling

Istället för att matcha historik mot SG-tidpunkter, skapa **en snapshot per synkcykel** med värdena som redan finns tillgängliga i synkpipelinen:

- **pill_temp** + **sg**: från senaste pill-telemetrin (redan hämtad)
- **controller_temp** + **profile_target_temp**: från `rapt_temp_controllers` (redan uppdaterad i Phase 1)
- **auto_target_temp** (snitt): beräknas direkt från pill_temp + controller_temp

### Plan

#### 1. Förenkla `createBrewSnapshots` → `createBrewSnapshot` (singular)

Ny signatur:
```typescript
export async function createBrewSnapshot(
  supabase: any,
  brewId: string,
  data: {
    recorded_at: string;
    sg: number | null;
    pill_temp: number | null;
    controller_temp: number | null;
    profile_target_temp: number | null;
  }
): Promise<boolean>
```

Funktionen:
- Tar emot **exakt en mätpunkt** med alla värden redan upplösta
- Beräknar `auto_target_temp` = snitt av pill + ctrl
- Gör `upsert` med `ignoreDuplicates: true` (unique on `brew_id, recorded_at`)
- Kör `thinSnapshots` fire-and-forget (behåll som idag)
- Ingen historik-lookup, ingen RPC, ingen binärsökning

#### 2. Uppdatera anroparna i `sync-rapt-data-quick`

Istället för att pusha `{ brewId, controllerId, sgData }` till `pendingSnapshots`, samla istället färdiga snapshot-objekt med alla värden upplösta direkt i synk-loopen där data redan finns tillgänglig:

```typescript
pendingSnapshots.push({
  brewId: brew.id,
  recorded_at: latestSgPoint.date,
  sg: latestSgPoint.value,
  pill_temp: latestSgPoint.temp,
  controller_temp: controller?.current_temp ?? null,
  profile_target_temp: controller?.profile_target_temp ?? null,
});
```

#### 3. Uppdatera `full-sync-brew-data` och `sync-custom-brew-pills`

Samma mönster — skicka färdiga värden istället för hela sgData-arrayen.

### Filer som ändras
- `supabase/functions/_shared/brew-snapshots.ts` — ny förenklad funktion
- `supabase/functions/sync-rapt-data-quick/index.ts` — uppdatera pendingSnapshots-logik
- `supabase/functions/full-sync-brew-data/index.ts` — samma
- `supabase/functions/sync-custom-brew-pills/index.ts` — samma

### Resultat
- ~80 rader → ~20 rader i brew-snapshots.ts
- Inga RPC-anrop, ingen historik-matchning
- Varje snapshot loggar exakt de värden som finns vid synktillfället
- Data låses och ändras aldrig i efterhand (befintligt `ignoreDuplicates` + inget UPDATE-policy)

