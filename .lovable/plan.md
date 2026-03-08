

## Plan: Förenkla synkprocessen — "Hämta först, bearbeta sedan"

### Nuläge
`sync-rapt-data-quick` är en 1066-raders monolit som blandar datahämtning, databearbetning, automation, historikloggning, snapshots, outage-detection och frekvenshantering i en enda funktion. Data passas runt via lokala variabler och maps istället för att läsas från databasen.

### Problem
- Brewfather-synk och custom brew-synk läser delvis från RAPT-data via lokala variabler (`allControllerData`, `pillTempMap`) istället från databasen
- Snapshot-skapande samlar data från lokala variabler under synken
- Om RAPT misslyckas måste alla efterföljande steg hantera `raptFailed` specialfall
- Svårt att debugga och underhålla

### Ny arkitektur

Alla steg efter steg 1 läser **uteslutande** från databasen — aldrig från lokala variabler.

```text
┌─────────────────────────────────┐
│  STEG 1: RAPT → Databas        │  Hämta pills + controllers,
│  (rapt_pills, rapt_temp_       │  upsert direkt. Klart.
│   controllers)                  │  Om det misslyckas → degraded,
│                                 │  men DB har cachad data.
├─────────────────────────────────┤
│  STEG 2: Brewfather → Databas  │  Läser controller-data från DB
│  (brew_readings)                │  via linked_controller_id.
├─────────────────────────────────┤
│  STEG 3: Custom brews → Databas│  Läser pill/controller från DB.
│  (brew_readings)                │  Behöver RAPT-token för telemetri.
├─────────────────────────────────┤
│  STEG 4: Automation            │  Läser allt från DB (redan idag
│  (run-automation invoke)        │  via brew_sg_data passthrough).
├─────────────────────────────────┤
│  STEG 5: Historik + Snapshots  │  Läser controllers från DB.
│  (temp_controller_history,     │  Läser brew_readings för snapshots.
│   brew_data_snapshots)          │
├─────────────────────────────────┤
│  STEG 6: Housekeeping          │  Outage, frekvens, decision log.
└─────────────────────────────────┘
```

### Konkreta ändringar i `sync-rapt-data-quick/index.ts`

#### Steg 1 — Oförändrat i princip
RAPT auth → fetch pills + controllers → upsert till `rapt_pills` och `rapt_temp_controllers`. Redan korrekt. Behåll som idag.

#### Steg 2 — Brewfather: Ta bort `allControllerData`-referens
Idag byggs `allControllerData` från lokala `controllerUpdates` och passas till `brewfatherSync()` (rad 571: `const ctrl = allControllerData.find(...)`).

Ändra till: efter Brewfather upsert, hämta controller-data direkt från `rapt_temp_controllers` i DB för snapshot-bygget:
```typescript
// Ersätt allControllerData.find() med DB-query
const linkedControllerIds = brewUpdates
  .map(u => existingBrewsMap.get(u.batch_id)?.linked_controller_id)
  .filter(Boolean);
const { data: ctrlRows } = await supabase
  .from('rapt_temp_controllers')
  .select('controller_id, current_temp, profile_target_temp')
  .in('controller_id', linkedControllerIds);
const ctrlMap = new Map(ctrlRows?.map(c => [c.controller_id, c]) || []);
```

#### Steg 3 — Custom brews: Ta bort `allPillData`/`allControllerData`
Idag byggs `allPillData` och `allControllerData` lokalt (rad 588-604) och skickas in i `customBrewSync()`.

Ändra till: custom brew-synken läser pills och controllers direkt från DB:
```typescript
const { data: dbPills } = await supabase
  .from('rapt_pills').select('pill_id, name, paired_device_id')
  .in('pill_id', selectedPillIds);
const { data: dbControllers } = await supabase
  .from('rapt_temp_controllers')
  .select('controller_id, linked_pill_id, pill_temp, current_temp, target_temp, profile_target_temp')
  .in('controller_id', selectedControllerIds);
```

#### Steg 5 — Historik: Redan korrekt
`tempHistoryTask` (rad 867-909) läser redan från `rapt_temp_controllers` i DB. Behåll som idag.

#### Steg 5 — Snapshots: Läs controller-data från DB
Idag samlas snapshots i `pendingSnapshots` under synk-loopen med lokala variabler. 

Ändra till: bygg snapshot-data efter automation genom att läsa `brew_readings` (färsk data) + `rapt_temp_controllers` (PID-justerade värden):
```typescript
const snapshotTask = async () => {
  const { data: activeBrews } = await supabase
    .from('brew_readings')
    .select('id, batch_id, current_sg, current_temp, last_update, linked_controller_id, status, sg_data')
    .in('status', ['Jäsning', 'Fermenting']);
  if (!activeBrews?.length) return;

  const ctrlIds = activeBrews.map(b => b.linked_controller_id).filter(Boolean);
  const { data: ctrls } = await supabase
    .from('rapt_temp_controllers')
    .select('controller_id, current_temp, profile_target_temp')
    .in('controller_id', ctrlIds);
  const ctrlMap = new Map(ctrls?.map(c => [c.controller_id, c]) || []);

  for (const brew of activeBrews) {
    const sgArr = brew.sg_data;
    if (!sgArr?.length) continue;
    const latest = sgArr[sgArr.length - 1];
    const ctrl = ctrlMap.get(brew.linked_controller_id);
    await createBrewSnapshot(supabase, brew.id, {
      recorded_at: latest.date,
      sg: latest.value,
      pill_temp: latest.temp,
      controller_temp: ctrl?.current_temp ?? null,
      profile_target_temp: ctrl?.profile_target_temp ?? null,
    });
  }
};
```

#### Steg 6 — Decision log: Ta bort `pillDataMap`
Idag byggs `pillDataMap` lokalt (rad 275-288) och används i decision log (rad 1010-1020).

Ändra till: läs pill-data från `rapt_pills` i DB:
```typescript
const { data: dbPillsForLog } = await supabase
  .from('rapt_pills').select('pill_id, name, gravity, battery_level, temperature, last_update')
  .in('pill_id', selectedPillIds);
```

### Resultat
- **Steg 1 skriver**, alla andra steg **läser från DB**
- Inga lokala variabel-maps som passas mellan faser
- Om RAPT misslyckas har DB cachad data — alla efterföljande steg fungerar ändå
- Enklare att debugga: varje steg kan köras isolerat
- ~100 rader bort (lokala map-byggen, allControllerData, allPillData, pillDataMap)

### Filer som ändras
- `supabase/functions/sync-rapt-data-quick/index.ts` — refaktorera fas 2-6 att läsa från DB

