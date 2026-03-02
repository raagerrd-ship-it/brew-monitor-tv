

## Ändring: Omstrukturera kollapsade rader i beslutsloggen

### Nuvarande layout (grid)
```text
[Badge] [Tid]       [Justering]     [ms]  [▼]
Glykol  2 mars 20:25  -0.8° → 0°  6895ms  ▼
```

### Ny layout
```text
[Tid]        [Badge med justering]     [ms]  [▼]
2 mars 20:25  ❄ Glykol -0.8° → 0°    6895ms  ▼
```

Tiden flyttas till vänster. Badge:n slår ihop kategori-ikonen/labeln med justeringstexten (t.ex. `❄ Glykol -0.8° → 0°`). Den separata `headerSummary`-kolumnen tas bort.

### Teknisk plan

**Fil:** `src/components/AutoCoolingDecisionLogs.tsx`

1. **Ändra grid-template** (rad ~357): Från 5-kolumns `[auto_105px_1fr_auto_20px]` till 4-kolumns `[105px_1fr_auto_20px]` — tid först, sedan badge+justering, ms, chevron.

2. **Slå ihop headerSummary in i headerBadge** (rad ~329–353): Istället för att `headerBadge` och `headerSummary` är separata element, bygg ett enda badge-element som innehåller både kategori-ikon/label och justeringsvärdet (t.ex. `❄ Glykol  0° → -0.8°`). Systemrader visar `⚙ System  No adjustments` i badge.

3. **Flytta tid-span** till första kolumnen i grid.

