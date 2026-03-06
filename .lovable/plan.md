

# PWM burst avaktivering — timing fix

## Problem

PWM ON skickar 0°C till hårdvaran direkt. OFF lagras i `pending_rapt_retries` och processas först **nästa cykel** (5 min senare). Vid 20% duty (60s) kyls tanken i 300s istället för 60s. `dutySeconds` beräknas men används aldrig.

## Lösning: Delayed OFF via `run-automation`

Istället för att lägga reverten som pending (nästa cykel), returnera burst-metadata till `run-automation` som sover `dutySeconds` och sedan skickar OFF direkt.

### 1. `controller-adjustments.ts` — returnera burst-info istället för pending

Ändra PWM-blocket (rad 478-527):
- Ta bort insättning i `pending_rapt_retries` för PWM OFF
- Populera `PwmBurst` arrayen med `{ controllerId, offTarget, dutySeconds }` istället
- Behåll ON-skicket som idag (hw-only)

### 2. `auto-adjust-cooling/index.ts` — propagera bursts

Returnera `pwmBursts` arrayen i JSON-responsen (redan delvis implementerat, rad 460).

### 3. `run-automation/index.ts` — exekvera burst-timing

Efter steg 3 (PID/glycol), om `pwmBursts` finns i responsen:
- För varje burst: `await sleep(dutySeconds * 1000)`
- Skicka OFF via fetch till `rapt-update-controller` (SetTemperature)
- Logga resultatet

Serverlös timeout: `run-automation` har 60s+ timeout. Max burst = 240s (4 min). Om burst > tillgänglig tid, falla tillbaka på pending_rapt_retries (nuvarande beteende).

### 4. Säkerhet

- Om `run-automation` kraschar mitt i en sleep, finns ingen revert → hårdvaran stannar på 0°C i 5 min tills nästa cykel. **Fallback**: behåll pending_rapt_retries som backup. Skriv reverten BÅDE som pending OCH schemalägg sleep+OFF. Om sleep lyckas, ta bort pending. Om inte, körs reverten nästa cykel automatiskt.

### Filer som ändras
- `supabase/functions/_shared/controller-adjustments.ts` — burst-metadata + pending backup
- `supabase/functions/auto-adjust-cooling/index.ts` — returnera bursts
- `supabase/functions/run-automation/index.ts` — sleep + OFF-anrop

