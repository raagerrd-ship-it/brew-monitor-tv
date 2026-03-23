


## Fix: PID-korrigering persisteras genom PWM-cykler

### Problem (fas 1 — löst)
PI-integralen nollställdes vid varje PWM-burst → integralen kunde aldrig byggas upp.

**Fix:** Bara `latest_p_correction` nollställs, `accumulated_integral` bevaras.

### Problem (fas 2 — löst)
Även med bevarad integral: PID beräknade t.ex. `ctrl_target_pid = 14.6` men PWM reverterade alltid till det gamla DB-värdet (`ctrlTarget = 14.5`). PID-justeringen persisterades aldrig.

**Fix:** 
1. `offTarget` (revert-mål) sätts nu till `ctrlTargetPid` (PID-kompenserat, klampad till hw-gränser) istället för `ctrlTarget`.
2. DB:ns `target_temp` uppdateras till PID-värdet under PWM-bursten, så nästa cykel startar med det korrigerade målet.

### Förväntat resultat
Integralen bygger 0.02-0.04 per cykel → `ctrlTargetPid` stiger → DB `target_temp` stiger → revert-mål stiger → hårdvarumålet höjs gradvis tills 0.2°C-offseten elimineras. Bör konvergera inom 5-10 cykler.
