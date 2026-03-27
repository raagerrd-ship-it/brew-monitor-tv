

# Ta bort PID-skip vid aktiv PWM-burst

## Bakgrund

Idag hoppas PID-beräkningen helt om en PWM-burst är aktiv (pending PWM OFF-rad finns). Motivationen var att probetempen är artificiellt låg/hög under en burst. Men systemet använder `actual_temp` (pill-baserad fusion) som inte påverkas nämnvärt av bursten. Dessutom raderar koden redan gamla PWM OFF-uppgifter innan en ny burst schemaläggs (rad 514). Att skippa PID i 5 minuter gör systemet långsammare att reagera och skapar edge-case-buggar (förfallna rader, låst PID).

## Ändring

### `supabase/functions/_shared/controller-adjustments.ts`

1. **Ta bort pre-load av pending PWM reverts** (rad 166-177, ~12 rader) — hela queryn mot `pending_rapt_retries` + `pwmRevertMap`
2. **Ta bort PID_SKIP-blocket** (rad 188-196, ~9 rader) — `hasPendingPwmRevert`-checken + `continue`
3. **Ta bort stale-cleanup-logiken** som lades till i förra meddelandet (om den finns)

Resten av koden behöver ingen ändring — burst-schemalägningen (rad 512-520) raderar redan gamla PWM OFF-rader innan den skapar nya, så det finns ingen risk för dubbletter.

## Vad som händer efter ändringen

- PID kör varje cykel (5 min), oavsett om en burst pågår
- PID beräknar ny duty baserat på `actual_temp` (pill-fuserad, opåverkad av burst)
- Ny burst ersätter gammal (gamla PWM OFF raderas, ny schemaläggs)
- Systemet blir mer responsivt och koden enklare

## Omfattning

- 1 fil, ~20 rader borttagna

