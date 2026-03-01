

## Ändra `get_temp_history_sampled`: AVG → senaste värde för `current_temp`

### Analys

Du har helt rätt. AVG inom en 15-minutersbucket ger ett utjämnat värde som inte matchar det faktiska live-värdet vid en given tidpunkt. Under en cold crash där temperaturen sjunker snabbt blir genomsnittet missvisande — det ligger alltid "efter" det senaste riktiga värdet. Det finns inget bra skäl att använda AVG för `current_temp` i detta system:

- **target_temp** och **profile_target_temp** använder redan `ARRAY_AGG(...ORDER BY recorded_at DESC)[1]` (senaste värdet) — korrekt
- **cooling_enabled** använder `BOOL_OR` — rimligt (om kylning var på någon gång i bucketen)
- **current_temp** borde följa samma mönster som target_temp: senaste värdet i bucketen

### Ändring

En databasmigration som ersätter funktionen `get_temp_history_sampled`:

```sql
-- Ändra current_temp från ROUND(AVG(...)) till senaste värdet i bucketen
SELECT
  bucket AS recorded_at,
  (ARRAY_AGG(current_temp ORDER BY recorded_at DESC))[1]::NUMERIC AS current_temp,  -- ← ändrad
  (ARRAY_AGG(target_temp ORDER BY recorded_at DESC))[1]::NUMERIC AS target_temp,
  BOOL_OR(cooling_enabled) AS cooling_enabled,
  (ARRAY_AGG(profile_target_temp ORDER BY recorded_at DESC))[1]::NUMERIC AS profile_target_temp
FROM bucketed
GROUP BY bucket
ORDER BY bucket;
```

### Påverkan

- **brew_data_snapshots**: `createBrewSnapshots` använder denna funktion — snapshots kommer nu matcha live-värdet från automationsloggen
- **Controller-chart**: Använder samma RPC för att rita grafer — ingen visuell skillnad i praktiken (skillnaden inom en 15-min bucket är minimal i normalfall, men korrekt under snabba ändringar)
- **Ingen kodändring** behövs i frontend eller edge functions — bara SQL-funktionen uppdateras

