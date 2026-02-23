

# Logga RAPT API-avbrottstid

## Vad

Nar RAPT API gar ner och sedan kommer tillbaka, logga hur lange avbrottet varade. Detta ger dig historik over alla RAPT API-avbrott.

## Hur det fungerar

Systemet sparar tidpunkten for senast lyckade RAPT-synk. Nar en synk misslyckas (som nu med 503-felet) andras inget. Nar nasta synk lyckas jamfor den mot senaste lyckade tidpunkt -- om det gatt langre an forvantad sync-intervall loggas det som ett avbrott.

```text
Synk OK (09:00) --> last_successful_rapt_sync = 09:00
Synk FAIL (09:05) --> inget andras
Synk FAIL (09:10) --> inget andras  
Synk OK (09:25) --> avbrott: 25 min (09:00 - 09:25), loggas i rapt_outage_log
```

## Andringar

### 1. Ny databastabell: `rapt_outage_log`

| Kolumn | Typ | Beskrivning |
|--------|-----|-------------|
| id | uuid | Primarnykel |
| outage_start | timestamptz | Senaste lyckade synk fore avbrottet |
| outage_end | timestamptz | Forsta lyckade synk efter avbrottet |
| duration_seconds | integer | Beraknad avbrottstid |
| created_at | timestamptz | Nar raden skapades |

RLS: SELECT for alla, INSERT for service role.

### 2. Ny kolumn pa `sync_settings`: `last_successful_rapt_sync_at`

Sparar tidpunkten for senaste *lyckade* RAPT API-synk (till skillnad fran `last_rapt_quick_sync_at` som uppdateras oavsett resultat).

### 3. Uppdatera `sync-rapt-data-quick/index.ts`

Tva andringar:

**Vid lyckad synk (efter att pills/controllers uppdaterats):**
- Las `last_successful_rapt_sync_at` fran `sync_settings`
- Om det gatt mer an 2x sync-intervallet (tex >10 min vid 5 min intervall): skriv en rad i `rapt_outage_log` med start/slut/varaktighet
- Uppdatera `last_successful_rapt_sync_at` till nu

**Flytta timestamp-uppdateringen:** `last_rapt_quick_sync_at` uppdateras fortfarande i borjan (som nu), men den nya `last_successful_rapt_sync_at` uppdateras bara vid lyckat resultat.

## Tekniska detaljer

```typescript
// Efter lyckad synk, innan return:
const { data: settings } = await supabase
  .from('sync_settings')
  .select('last_successful_rapt_sync_at, rapt_sync_interval')
  .single();

const lastSuccess = settings?.last_successful_rapt_sync_at;
const now = new Date();

if (lastSuccess) {
  const gap = (now.getTime() - new Date(lastSuccess).getTime()) / 1000;
  const threshold = (settings?.rapt_sync_interval || 300) * 2; // 2x intervallet
  
  if (gap > threshold) {
    await supabase.from('rapt_outage_log').insert({
      outage_start: lastSuccess,
      outage_end: now.toISOString(),
      duration_seconds: Math.round(gap),
    });
    console.log(`RAPT API outage logged: ${Math.round(gap)}s`);
  }
}

// Uppdatera lyckad-tidstampel
await supabase.from('sync_settings')
  .update({ last_successful_rapt_sync_at: now.toISOString() })
  .eq('id', settingsId);
```

## Vad som INTE andras

- Ingen UI-andring (loggen kan lases via databasen)
- Felhanteringen i catch-blocket forblir oforandrad
- `last_rapt_quick_sync_at` fungerar som vanligt

