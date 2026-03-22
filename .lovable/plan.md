

## Problem

PWM-loggarna i synkhistoriken visar tre separata rader för vad som logiskt är en tvåstegsprocess:

1. **18:05** — `⚡ Blå 14.2° → 0°` (PWM ON adjustment, orphan-rad)
2. **18:06** — `✈ Blå 14.3° → 0°` + `⚡ Blå 0° → 14.3°` (RAPT-send + PWM OFF i samma rad)

**Förväntat beteende:**
- System-synkloggen (decision log) ska innehålla PWM ON-aktiveringen som en del av sin pipeline
- PWM OFF ska vara en enskild, separat rad som dyker upp efter burst-varaktigheten

## Orsak

PWM ON skapar **två** loggposter:
- En `auto_cooling_adjustments`-rad via `logAdjustment()` i `controller-adjustments.ts` (rad 397)
- En `RAPT_SEND` decision-step + `DUTY_PWM_BURST` i beslutsloggen

ON-adjustment-raden skapas innan beslutsloggen sparas, med en liten tidsförskjutning som gör att den hamnar utanför 15-sekunders-matchningsfönstret → blir en orphan-rad med eget ⚡-badge.

PWM OFF-adjustment-raden (skapad av `run-automation` rad 199) matchas till nästa System-logg istället för att stå ensam.

## Plan

### 1. Ta bort redundant PWM ON adjustment-loggning (backend)
**Fil:** `supabase/functions/_shared/controller-adjustments.ts`

Ta bort `logAdjustment()`-anropet för PWM ON (rad 396-405). ON-händelsen dokumenteras redan fullständigt av:
- `DUTY_PWM_BURST` decision-steget (som syns i System-loggens pipeline)
- `RAPT_SEND` decision-steget (som visar att kommandot skickats)

Detta eliminerar den duplicerade orphan-raden.

### 2. Ge PWM OFF sin egen decision-logg (backend)
**Fil:** `supabase/functions/run-automation/index.ts`

Efter lyckad PWM OFF (rad 186-211): Skapa en **egen `auto_cooling_decision_logs`-rad** med:
- `final_result`: t.ex. `"⚡ PWM OFF: Blå 0° → 14.3° (33s burst)"`
- `decisions`: En minimal decision-array med burst-metadata (duty_pct, duty_seconds, controller_name)
- `adjustment_made: true`

Behåll den existerande `auto_cooling_adjustments`-inserten (rad 199) så att OFF-adjustment matchas till denna nya decision-logg via 15s-fönstret.

### 3. Uppdatera UI för PWM OFF-loggar (frontend)
**Fil:** `src/components/AutoCoolingDecisionLogs.tsx`

Lägg till logik för att rendera PWM OFF decision-loggar med en kompakt vy:
- Collapsed: Visa tidstämpel + `⚡ PWM OFF Blå 0° → 14.3°` badge
- Expanded: Visa burst-detaljer (duration, duty%) med befintlig PWM-styling

## Teknisk sammanfattning

```text
FÖRE:
  18:05  ⚡ Blå 14.2° → 0°          ← orphan adjustment (redundant)
  18:06  ✈ Blå 14.3° → 0° + ⚡ OFF  ← ON-send + OFF blandade
  18:06  ⟳ System                    ← decision log

EFTER:
  18:05  ⟳ System [PWM ▶ Blå]        ← decision log med PWM ON inuti
  18:06  ⚡ PWM OFF Blå 0° → 14.3°   ← egen decision log för OFF
```

### Filer som ändras
- `supabase/functions/_shared/controller-adjustments.ts` — Ta bort `logAdjustment` för PWM ON
- `supabase/functions/run-automation/index.ts` — Skapa decision-logg för PWM OFF
- `src/components/AutoCoolingDecisionLogs.tsx` — Rendera PWM OFF decision-loggar

