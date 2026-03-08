

## Plan: Förbättra snapshot-data och Synkad data-dialogen

### Problem
1. **"Mål"-kolumnen** i Synkad data visar `profile_target_temp` som hämtas via `get_temp_history_sampled` med nearest-neighbor-matchning. Värdet bör istället låsas direkt från kontrollerns `profile_target_temp` vid snapshot-tidpunkten — inte interpoleras från historikdata.
2. **"PID"-kolumnen** visar `auto_target_temp` (hårdvarumålet). Användaren vill istället visa den **fusionerade medel-temperaturen** (snitt av pill + controller), vilket ger all data som behövs för att generera diagrammet direkt från tabellen.

### Lösning

#### 1. Ändra snapshot-skapandet (`supabase/functions/_shared/brew-snapshots.ts`)
- **`profile_target_temp`**: Använd redan befintliga `currentControllerState.profile_target_temp` som primärkälla istället för att matcha mot samplad historik. Profilmålet ändras sällan och det aktuella värdet från `rapt_temp_controllers` är det korrekta "låsta" värdet.
- **`auto_target_temp`**: Byt till att lagra den fusionerade medeltemperaturen (pill + controller) / 2 istället för `target_temp`. Beräkna direkt vid snapshot-tidpunkten från `pill_temp` och `controller_temp` som redan finns i samma snapshot-rad.

Konkret ändring i snapshot-mappningen (rad ~116-128):
```typescript
return {
  brew_id: brewId,
  recorded_at: point.date,
  sg: point.value,
  pill_temp: point.temp,
  controller_temp: closest?.current_temp ?? currentControllerState?.current_temp ?? null,
  // Mål = profilmålet, låst vid loggningstillfället
  profile_target_temp: currentControllerState?.profile_target_temp ?? closest?.profile_target_temp ?? null,
  // Justerad temp = fusionerat medelvärde (pill + ctrl) / 2
  auto_target_temp: (() => {
    const pill = point.temp;
    const ctrl = closest?.current_temp ?? currentControllerState?.current_temp ?? null;
    return (pill != null && ctrl != null) ? (pill + ctrl) / 2 : pill ?? ctrl ?? null;
  })(),
};
```

#### 2. Uppdatera Synkad data-dialogen (`src/components/brew-card/SyncedDataDialog.tsx`)
- Byt kolumnrubriken "PID" → "Snitt" (fusionerad medeltemp)
- Ändra synlighetsvillkoret `hasAutoAdjustments` till att istället kontrollera om det finns data med både pill och controller (dvs. om snitt kan beräknas)
- Formatera värdet med 1 decimal + °

#### 3. Uppdatera server-renderad SVG (`supabase/functions/render-brew-chart/index.ts`)
- Ingen ändring behövs — den beräknar redan avgTemp från pill_temp + controller_temp direkt.

### Filer som ändras
- `supabase/functions/_shared/brew-snapshots.ts` — snapshot-mappning
- `src/components/brew-card/SyncedDataDialog.tsx` — kolumnrubrik och villkor

### Notering
Befintliga snapshots behåller sina gamla värden. Nya snapshots får korrekta värden framåt. Om man vill korrigera historisk data kan man köra en engångs-migration, men det bör inte behövas i praktiken.

