

# Fixa kvarvarande bugg i auto-adjust-cooling

## Problem

En **runtime-kraschande bugg** finns pa rad 1117 i `supabase/functions/auto-adjust-cooling/index.ts`.

Vid refaktoreringen fran `supabase.functions.invoke()` till `setControllerTargetTemp()` missades en felhanteringsrad som fortfarande refererar den gamla variabeln `updateResponse.error`. Variabeln existerar inte langre, sa om cooling recovery nagonsin misslyckas kastas ett `ReferenceError` som kraschar hela funktionen.

## Fix

**Fil:** `supabase/functions/auto-adjust-cooling/index.ts`

Rad 1117: Byt fran:
```text
log('COOLING_RECOVERY', 'fail', `Failed to update cooler: ${JSON.stringify(updateResponse.error)}`);
```
till:
```text
log('COOLING_RECOVERY', 'fail', `Failed to update cooler`);
```

Variabeln `coolRecSuccess` (boolean) innehaller inget felobjekt, sa ett generiskt meddelande ar korrekt. Detaljerade fel loggas redan inuti `setControllerTargetTemp`.

## Omfattning

- 1 fil, 1 rad
- Deploya `auto-adjust-cooling`

