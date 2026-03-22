## Asynkron PWM OFF — Implementerat ✅

PWM OFF är nu frikopplad från `run-automation`:

1. **`controller-adjustments.ts`**: Sparar `execute_at = now() + duty_seconds` i `pending_rapt_retries` istället för att pusha till `ctx.pwmBursts`
2. **`execute-pwm-off` edge function**: Ny funktion som pollar `pending_rapt_retries` för förfallna PWM OFF-kommandon, skickar till RAPT, skapar decision-logg
3. **pg_cron**: Kör `execute-pwm-off` varje minut via `trigger_execute_pwm_off()`
4. **`run-automation`**: Hela STEP 3b (sleep + retry-loop) borttagen — ingen blockering
