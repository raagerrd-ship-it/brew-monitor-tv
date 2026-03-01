

## Problem

Snapshot-skapande sker i fel steg i synkcykeln:

```text
Nuvarande ordning:
  Phase 1:  Synka RAPT-data → uppdatera rapt_temp_controllers
  Phase 2a: Brewfather readings + skapa snapshots  ← FEL, för tidigt
  Phase 2b: Automation (PID)
  Phase 2c: Logga temp_controller_history

Önskad ordning:
  Phase 1:  Synka RAPT-data
  Phase 2a: Brewfather readings (UTAN snapshots)
  Phase 2b: Automation (PID)
  Phase 2c: Logga historik + skapa snapshots  ← RÄTT, alla värden är klara
```

Eftersom snapshots skapas innan PID körs och innan historik skrivs, måste `createBrewSnapshots` använda "recent point"-hacket för att hämta live-data från `rapt_temp_controllers`. Om snapshots istället skapas sist behövs inget hack — alla värden finns redan i DB:n.

## Plan

### 1. Flytta snapshot-skapande från Phase 2a till Phase 2c

I `sync-rapt-data-quick/index.ts`:

- **Ta bort** snapshot-logiken ur `brewfatherSync()` (rad 350-365)
- **Samla** brew-uppdateringarna (`brewUpdates` + `existingBrewsMap`) så de är tillgängliga utanför closuren
- **Skapa snapshots** i Phase 2c, parallellt med temp history och outage detection, efter att automation kört klart

### 2. Ta bort "recent point"-hacket från brew-snapshots.ts

Eftersom snapshots nu alltid skapas efter att:
- `rapt_temp_controllers` uppdaterats (Phase 1)
- PID-automation justerat `target_temp`/`profile_target_temp` (Phase 2b)
- `temp_controller_history` skrivits (Phase 2c, parallellt)

...så kan `createBrewSnapshots` gå tillbaka till enkel logik:
- Ta bort `RECENT_THRESHOLD_MS`, `isRecent`, `useLive`
- Använd `currentControllerState` (live DB) som primär källa, `findClosest` (historik) som fallback

### 3. Samma fix i full-sync-brew-data

`full-sync-brew-data/index.ts` skapar också snapshots direkt efter brew-upsert (rad ~180). Flytta även dessa till efter automation + historikloggning.

## Teknisk detalj

Snapshot-data som samlas i Phase 2a (brew_id, linked_controller_id, sg_data) sparas i en array som sedan konsumeras i Phase 2c:

```typescript
// Phase 2a — samla snapshot-jobb
const pendingSnapshots: { brewId: string; controllerId: string | null; sgData: any[] }[] = [];

// Phase 2c — kör snapshots efter automation + historik
const snapshotTask = async () => {
  for (const s of pendingSnapshots) {
    await createBrewSnapshots(supabase, s.brewId, s.controllerId, s.sgData);
  }
};
```

