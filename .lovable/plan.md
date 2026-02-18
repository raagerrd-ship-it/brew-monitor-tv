

# Refaktorera RAPT-datahämtning: Centraliserad cache-tabell

## Bakgrund

Idag hämtar flera edge functions RAPT-data oberoende av varandra via separata API-anrop:
- `sync-rapt-data` och `sync-rapt-data-quick` hämtar pills + controllers direkt från RAPT API
- `sync-custom-brew-pills` hämtar en ny auth-token och telemetri separat
- `auto-adjust-cooling` försöker berika `pill_temp` genom att gräva i `brew_readings.sg_data`

Detta leder till:
- Onödiga API-anrop mot RAPT
- `pill_temp` som saknas i `rapt_temp_controllers` (API returnerar 0 för `controlDeviceTemperature`)
- Stall-detektion som inte ser jäshastighet eftersom den inte har rätt data

## Ny arkitektur

```text
RAPT API
   |
   v
[sync-rapt-data-quick]  <-- cron (var 5:e min eller inställd)
   |
   +-- Hämtar Pills + Controllers + Telemetri (senaste)
   +-- Skriver ALLT till rapt_pills + rapt_temp_controllers
   +-- Berikar pill_temp från telemetri direkt
   |
   v
rapt_pills / rapt_temp_controllers  (med realtime)
   |
   +---> auto-adjust-cooling (läser BARA från DB, ingen RAPT API)
   +---> sync-custom-brew-pills (läser pill_temp från DB, hämtar telemetri för SG)
   +---> UI-komponenter (via realtime)
```

## Steg-för-steg

### 1. Uppdatera `sync-rapt-data-quick` att berika pill_temp

Problemet idag: RAPT API returnerar `controlDeviceTemperature = 0` för controllers. Men pill-telemetrin (via `GetHydrometers`) har korrekt temperatur.

**Ändring:** Efter att ha hämtat pills OCH controllers:
- Matcha controllers `linkedDevice`-fält mot pill-id
- Hämta senaste temperatur från pill-data (pill.temperature eller senaste telemetri-punkt)
- Skriv detta som `pill_temp` till `rapt_temp_controllers`
- Spara även `linked_pill_id` på controllern om det inte redan finns

### 2. Uppdatera `auto-adjust-cooling` att BARA läsa från databasen

Ta bort all "enrichment"-logik som hämtar pill_temp från brew_readings.sg_data. Funktionen ska:
- Läsa `rapt_temp_controllers` (som nu har korrekt `pill_temp`)
- Läsa `brew_readings` för OG/FG/SG/jäshastighet (redan implementerat)
- Inte anropa RAPT API alls

### 3. Aktivera Realtime på `rapt_temp_controllers` och `rapt_pills`

Lägg till dessa tabeller i `supabase_realtime` så att UI:t och andra konsumenter kan reagera direkt när synken uppdaterar datan.

### 4. Spara pill-till-controller-koppling

RAPT API returnerar vilken pill som är kopplad till vilken controller. Synka detta till `rapt_temp_controllers.linked_pill_id` automatiskt.

## Tekniska detaljer

### Dataflöde i `sync-rapt-data-quick` (uppdaterad)

```text
1. Hämta RAPT auth token
2. Hämta alla Pills (GetHydrometers)
   - Varje pill har: id, name, battery, lastActivityTime, temperature
3. Hämta alla Controllers (GetTemperatureControllers)  
   - Varje controller har: id, name, temperature, targetTemperature,
     controlDeviceTemperature (ofta 0!), coolingEnabled, etc.
4. Bygg pill-temp-map: { pill_id -> senaste temp från pill-data }
5. För varje controller:
   - Kolla om RAPT returnerar en linked pill (via API-data)
   - Hämta pill_temp från pill-temp-map istället för controlDeviceTemperature
   - Skriv allt till rapt_temp_controllers inkl pill_temp och linked_pill_id
6. Skriv pill-data till rapt_pills
```

### Ändring i `auto-adjust-cooling`

```text
FÖRE (rad 192-215):
  - Om pill_temp saknas, hämta från brew_readings.sg_data
  
EFTER:
  - Läs pill_temp direkt från rapt_temp_controllers (redan berikat av synk)
  - Ta bort hela enrichment-blocket
```

### Migration: Realtime

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.rapt_temp_controllers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.rapt_pills;
```

## Filer som ändras

1. **`supabase/functions/sync-rapt-data-quick/index.ts`** - Berika pill_temp från pill-data, spara linked_pill_id
2. **`supabase/functions/auto-adjust-cooling/index.ts`** - Ta bort enrichment-logik (rad 192-215), lita på DB-data
3. **Databasmigration** - Aktivera realtime på rapt_temp_controllers och rapt_pills

## Vad detta löser

- pill_temp blir korrekt i databasen (hämtas från pill, inte controller API)
- auto-adjust-cooling slipper hacka ihop pill_temp från brew_readings
- Stall-detektion och overshoot har alltid korrekt temperaturdata
- Alla konsumenter läser samma datakälla
- Färre API-anrop mot RAPT

