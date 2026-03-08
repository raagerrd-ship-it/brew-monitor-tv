

## Plan: Använd controllerns timestamp för snapshots

### Nuläge
`snapshotTask` läser redan all data från DB (korrekt). Men `recorded_at` sätts till `latest.date` från `sg_data`-arrayen istället för controllerns `last_update`.

### Ändring

**Fil: `supabase/functions/sync-rapt-data-quick/index.ts`** — snapshotTask (rad 884-888)

1. Lägg till `last_update` i controller-queryn:
```typescript
.select('controller_id, current_temp, profile_target_temp, last_update')
```

2. Använd controllerns `last_update` som `recorded_at` (rad 898):
```typescript
recorded_at: ctrl?.last_update || latest.date || new Date().toISOString(),
```

### Resultat
- Timestamp reflekterar när controllern senast rapporterade till RAPT
- Alla 6 fält kommer från DB (steg 1-data)
- 2 raders ändring i en fil

