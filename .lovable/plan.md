

# Undvik duplicerade justeringar mot samma temperaturdata

## Problem
Auto-cooling funktionen kors varje minut, men RAPT-kontrollerna uppdaterar sin temperatur bara ca var 15:e minut. Det innebar att funktionen kan gora flera justeringar baserat pa samma temperaturavskning -- samma pill_temp och current_temp som redan hanterats.

## Losning
Spara tidsstampeln (`last_update`) fran kontrollern nar en justering gors, och jamfor mot den vid nasta korning. Om `last_update` inte andrats sedan senaste justeringen -- hoppa over den kontrollern.

## Tekniska detaljer

### 1. Databas: Lagg till kolumn `adjusted_against_timestamp`
Lagg till en kolumn i `auto_cooling_adjustments` som sparar vilken `last_update` fran kontrollern som justeringen baserades pa.

```sql
ALTER TABLE auto_cooling_adjustments 
  ADD COLUMN adjusted_against_timestamp timestamptz;
```

### 2. Edge function: `auto-adjust-cooling/index.ts`

**A. Hamta senaste justeringens timestamp per controller**

Innan overshoot- och stall-looparna, hamta senaste `adjusted_against_timestamp` per followed controller:

```typescript
const lastAdjTimestampMap = new Map<string, string>();
for (const fc of followedControllersFullData) {
  const { data: lastAdj } = await supabase
    .from('auto_cooling_adjustments')
    .select('adjusted_against_timestamp')
    .eq('cooler_controller_id', fc.controller_id)
    .not('adjusted_against_timestamp', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1);
  if (lastAdj?.[0]?.adjusted_against_timestamp) {
    lastAdjTimestampMap.set(fc.controller_id, lastAdj[0].adjusted_against_timestamp);
  }
}
```

**B. Kontrollera i varje loop (overshoot + stall)**

I borjan av varje controller-iteration, jamfor `last_update` fran `rapt_temp_controllers` med sparad timestamp:

```typescript
// Fetch last_update from controller data (need to add to query)
const controllerLastUpdate = fc.last_update; 
const lastAdjTs = lastAdjTimestampMap.get(fc.controller_id);

if (lastAdjTs && controllerLastUpdate && lastAdjTs === controllerLastUpdate) {
  log('SKIP_SAME_DATA', 'info', 
    `${fc.name}: Samma data som senaste justering (${controllerLastUpdate}), hoppar over`);
  continue;
}
```

**C. Spara timestamp vid justering**

I alla `insert` till `auto_cooling_adjustments`, lagg till:
```typescript
adjusted_against_timestamp: fc.last_update
```

**D. Uppdatera TempController-interfacet**

Lagg till `last_update` i TempController-interfacet och se till att SELECT-fragan inkluderar det.

### 3. Logg-visning (valfritt)

Logga `last_update` i `FOLLOWED_DATA`-blocket sa det syns i beslutloggen:
```typescript
last_update: fc.last_update
```

### Sammanfattning av andringar
- **Migration**: 1 ny kolumn pa `auto_cooling_adjustments`
- **Edge function**: ~20 rader ny kod for att hamta, jamfora och spara timestamps
- Inga UI-andringar behovs

