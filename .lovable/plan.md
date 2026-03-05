

## PWM on_target = 0°C

### Vad

Ändra PWM burst-logiken så att `on_target` alltid sätts till **0°C** istället för det PID-beräknade målet. Detta ger:
1. Tydlig visuell signal att PWM-funktionen är aktiv (0°C syns i logg/UI)
2. Garanterad kylaktivering oavsett hysteres (0°C är under alla enheters min_target_temp)

### Teknisk ändring

**Fil: `supabase/functions/_shared/controller-adjustments.ts`** (rad 446)
- Ändra `const onTarget = round1(ctrlTargetPid)` till `const onTarget = 0`
- Uppdatera loggmeddelandet för att reflektera det fasta värdet

**Fil: `supabase/functions/run-automation/index.ts`**
- Ingen ändring behövs, den skickar redan `burst.on_target` till RAPT API

### Notering

`rapt-update-controller` validerar att target är mellan -10 och 40, så 0°C passerar. Enhetens `min_target_temp` (typiskt -5) tillåter också 0°C.

