

# Fix: Falska "manuella hårdvaruändring"-loggar för Blå

## Problem
RAPT-hårdvaran rapporterar ibland targets som avviker ~0.2°C från vad PID skickade (t.ex. PID skickar 6.3°C, RAPT rapporterar 6.1°C). Automation-latens-filtret har 0.15°C tolerans, vilket är för snävt. Resultatet: falska "manuell ändring"-loggar var ~90 min.

## Lösning
Öka toleransen i `isAutomationLatency`-jämförelsen från **0.15** till **0.25°C**. Detta täcker RAPT-hårdvarans avrundningsfel utan att missa verkliga manuella ändringar (som typiskt är ≥0.5°C steg).

## Ändring

**Fil: `supabase/functions/sync-rapt-data-quick/index.ts`** (rad 424-426)

Ändra:
```typescript
const isAutomationLatency = recentAdjs?.some(adj =>
  Math.abs(targetTemp - adj.old_target_temp) < 0.15 ||
  Math.abs(targetTemp - adj.new_target_temp) < 0.15
) ?? false;
```
Till:
```typescript
const isAutomationLatency = recentAdjs?.some(adj =>
  Math.abs(targetTemp - adj.old_target_temp) < 0.25 ||
  Math.abs(targetTemp - adj.new_target_temp) < 0.25
) ?? false;
```

En ändring, en rad per jämförelse. Eliminerar brusiga false-positive-loggar utan risk att missa verkliga manuella justeringar.

