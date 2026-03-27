

# Visa SKIP-badge enbart vid 0% duty

## Problem
SKIP-badgen visas även vid `DUTY_PHASE_B` (fas B av A/B-alterneringen där bursten råkar vara 0 sekunder, t.ex. 10% duty). Användaren förväntar sig att SKIP enbart visas när duty faktiskt är 0%.

## Ändring

### `src/components/AutoCoolingDecisionLogs.tsx`

1. **Badges (rad ~511)**: Ändra filtret från `DUTY_PHASE_B || DUTY_ZERO` till enbart `DUTY_ZERO`
2. **Synktabell pwmSkipNames (rad ~1092)**: Samma ändring — ta bort `DUTY_PHASE_B` och `DUTY_PWM_SKIP` från filtret, behåll enbart `DUTY_ZERO`

`DUTY_PHASE_B` visas redan som dold steg (i HIDDEN_STEPS) och behöver ingen badge — systemet reglerar aktivt, det är bara den ena fasen som inte avfyrar burst.

## Omfattning
1 fil, 2 rader ändrade

