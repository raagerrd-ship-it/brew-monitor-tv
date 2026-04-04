
Målet är att göra två saker samtidigt: få bort de återkommande falska/generiska `pid-glycol`-felen och få glykolkylaren att faktiskt hjälpa Blå mer aggressivt när den belastas.

1. Bekräftad nulägesbild
- Jag kunde se felcykler i beslutsloggen vid 19:15, 19:30, 19:35 och 20:05 lokal tid.
- Dessa loggas idag bara som `PID_ERROR` med `step: auto-adjust-cooling` och en kort duration, men utan själva felorsaken.
- Samtidigt visar senaste lyckade körning att kylaren fortfarande använder ungefär `margin 4.88°C`, vilket ger kylarmål runt `1.6°C`.
- I `cooler-management.ts` finns fortfarande buggen där boost-faktorn räknas ut vid hög last men aldrig sparas.

2. Vad jag skulle implementera
- Fixa buggen i `supabase/functions/_shared/cooler-management.ts`
  - När utilization är hög nog ska den beräknade boosten verkligen appliceras via `batch.update(...)`.
  - Loggen ska visa gammal och ny marginal samt vilket load/temp-bucket som påverkades.
- Förbättra feldiagnostik i `supabase/functions/sync-rapt-data-quick/index.ts`
  - Spara mer detaljer i `PID_ERROR.details`, t.ex. HTTP-status, timeout-flagga och feltext från `auto-adjust-cooling`.
  - Då kan framtida fel särskiljas mellan deploy-404, timeout, intern kodbugg eller dataproblem.
- Förbättra felretur i `supabase/functions/auto-adjust-cooling/index.ts`
  - Nu returneras bara `error` + `decisionLog` vid 500.
  - Jag skulle lägga till strukturerad felpayload så orkestratorn kan spara tydligare orsak uppströms.
- Härda retry-logiken för edge-anrop
  - Samordna `run-automation` och `sync-rapt-data-quick` så 404/502/503 behandlas likadant.
  - Behåll längre väntan för 404 under redeploy och se till att feltext följer med i loggen.
- Minska “falska” larm
  - Notiser om `automation_failure` ska fortsatt bara skickas vid upprepade fel, men med tydligare text om exakt orsak istället för bara `pid-glycol`.

3. Förväntad effekt
- Kylaren ska börja sänka sitt mål mer när Blå verkligen behöver hjälp, istället för att fastna runt samma inlärda marginal.
- Vid nästa fel får vi direkt veta om det var:
  - timeout
  - tillfällig deploy/redeploy
  - intern exception i auto-cooling
  - problem med inputdata eller retry-hantering

4. Tekniska detaljer
- Filer som bör ändras:
  - `supabase/functions/_shared/cooler-management.ts`
  - `supabase/functions/sync-rapt-data-quick/index.ts`
  - eventuellt `supabase/functions/run-automation/index.ts` för konsekvent retry/felloggning
  - eventuellt `supabase/functions/auto-adjust-cooling/index.ts` för rikare error response
- Ingen databasmigration behövs för själva fixen om vi bara förbättrar befintliga loggfält.
- Om vi vill kunna analysera fel ännu bättre senare kan vi i ett nästa steg lägga till ett separat backend-fält för `error_code/error_message`, men det behövs inte för första fixen.

5. Rekommenderad ordning
- Steg A: laga cooler boost-buggen
- Steg B: förbättra error propagation mellan `auto-adjust-cooling` och orkestratorn
- Steg C: harmonisera retry/logik i båda orkestratorerna
- Steg D: verifiera i loggar att nästa cykler både ger tydligare felbild och bättre kylhjälp till Blå
