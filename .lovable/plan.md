

## Problem

PWM OFF blockerar `run-automation` med en `sleep()` på ~50-60 sekunder, vilket förvränger timing-diagnostiken (2b visar 64s) och håller hela synkcykeln onödigt länge.

## Ny arkitektur: Schemalagd PWM OFF

```text
FÖRE (blockerande):
  sync-rapt-data-quick → run-automation
    ├─ auto-adjust-cooling (PWM ON → RAPT)
    ├─ sleep(50s)  ← BLOCKERAR
    └─ PWM OFF → RAPT + logg

EFTER (asynkron):
  sync-rapt-data-quick → run-automation
    └─ auto-adjust-cooling (PWM ON → RAPT)
        └─ Sparar: pending_rapt_retries.execute_at = now() + duty_seconds
  
  pg_cron (varje minut) → execute-pwm-off
    └─ Hittar rader med execute_at <= now()
        └─ PWM OFF → RAPT + decision-logg
```

## Plan

### 1. Lägg till `execute_at`-kolumn på `pending_rapt_retries`
**Migration:** Lägg till `execute_at timestamptz DEFAULT null`. Null = vanlig retry (befintligt beteende). Satt = schemalagd PWM OFF.

### 2. Skapa edge function `execute-pwm-off`
Ny funktion som:
- Hämtar alla `pending_rapt_retries` där `reason LIKE '%PWM OFF%'` OCH `execute_at <= now()`
- Skickar OFF-kommando till RAPT (3 retries, 10s timeout)
- Vid lyckad: raderar retry-raden + skapar `auto_cooling_decision_logs`-post
- Vid misslyckad: inkrementerar attempts, behåller raden

### 3. Skapa pg_cron-jobb för PWM OFF
Kör `execute-pwm-off` varje minut via en DB-trigger-funktion (samma mönster som `trigger_rapt_quick_sync`).

### 4. Uppdatera `controller-adjustments.ts`
Sätt `execute_at: now() + duty_seconds` vid insert till `pending_rapt_retries` istället för att lägga burst-metadata i `ctx.pwmBursts`.

### 5. Ta bort PWM sleep-blocket ur `run-automation`
Radera hela STEP 3b (rad 136-219) — sömn, retry-loop, loggning. Allt hanteras nu av `execute-pwm-off`.

### Filer som ändras
- **Migration:** Ny kolumn `execute_at` på `pending_rapt_retries`
- **`supabase/functions/execute-pwm-off/index.ts`** — Ny edge function
- **`supabase/functions/_shared/controller-adjustments.ts`** — Sätt `execute_at` vid PWM ON
- **`supabase/functions/run-automation/index.ts`** — Ta bort sleep-blocket
- **Migration:** pg_cron-jobb + trigger-funktion

