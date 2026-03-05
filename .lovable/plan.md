

## PWM som ersättare för PID vid stabil temperatur

### Problem

PWM-blocket (rad 400-435) ligger **efter** no-op-guarden (rad 391: `if (pidDiff < 0.1) continue`). När PID har stabiliserat temperaturen blir pidDiff < 0.1 och koden hoppar ut innan PWM ens evalueras. Alltså aktiveras PWM aldrig i det scenario det är tänkt för.

### Koncept

PWM ska ta över temperaturhållningen när PID redan nått målet. Istället för att PID kontinuerligt mikrojusterar varje cykel (onödiga API-anrop, slitage), kör PWM en enkel on/off-cykling baserat på inlärd duty cycle:

```text
PID stabiliserar temp → pidDiff < 0.1 → PWM tar över
  ├─ Aktivt segment  → Sätt target = profileTarget - learned_margin (enkel offset)
  └─ Av-segment      → Sätt target = profileTarget (låt temp drifta upp naturligt)
```

### Ändringar

**`controller-adjustments.ts`** — Flytta och omstrukturera PWM-logiken:

1. Flytta PWM-kontrollen **före** `pidDiff < 0.1`-guarden
2. PWM aktiveras när: `pidMode === 'cooling'`, `stepType === 'hold'`, duty har ≥5 samples, duty < 60%, OCH temp är nära mål (pidDiff < 0.3 eller inom dödband)
3. Vid **av-segment**: sätt target till `actualTarget` (profilmålet rakt av, ingen PID-kompensation) och `continue`
4. Vid **aktivt segment**: låt PID köra som vanligt (fall through till befintlig PID-logik)
5. Om temp driftar iväg (pidDiff > 0.3 eller util > 70%): hoppa över PWM, kör full PID

Denna ändring innebär att:
- PWM körs bara när temp redan är stabil (nära mål)
- PID tar automatiskt tillbaka kontrollen om temp driftar
- Inga nya databas-kolumner behövs
- Beslutsloggen visar fortfarande DUTY_PWM med segment-info

