

# Översyn av bryggningsprocessen -- timer-synk och tydlighet

## Identifierade problem

### 1. `acknowledged`-faltet saknas i typdefinitionen
`TimerMilestone`-interfacet (rad 6-10 i `use-external-timer.ts`) saknar `acknowledged`-faltet som bryggappen nu skickar. Koden i `TimerFooter.tsx` (rad 213) tvingas använda `(alertMilestone as any).acknowledged` -- en osaker typcast.

Dessutom parsar `fetchFromCache` (rad 179-186) inte `acknowledged` fran databasen, sa faltet gar forlorat nar data lases fran cachen.

### 2. Edge-funktionen (`sync-external-timer`) sparar inte `acknowledged`
Edge-funktionen kopierar milstolparna rakt av som JSON, sa `acknowledged` borde folja med automatiskt. Men `TimerMilestone`-interfacet i edge-funktionen (rad 8-12) saknar ocksa faltet, vilket gor det otydligt.

### 3. Dod kod: `fetchFromExternal` anvands aldrig
Funktionen `fetchFromExternal` (rad 244-316 i `use-external-timer.ts`) ar definierad men anropas aldrig. All datahämtning gar via edge-funktionen `sync-external-timer` -> cache -> `fetchFromCache`. Denna doda kod forvirrar och bor tas bort.

### 4. Kommentar-mismatch i dismissal-logiken
Kommentaren pa rad 198 sager "auto-dismiss after 30+ seconds" men koden (rad 218) anvander 120 sekunder. Kommentaren bor uppdateras.

### 5. Timer-fas-övergångar (t.ex. Mäsk -> Kok -> Whirlpool)
Nar timern byter fas (t.ex. fran "Kokschema" till "Whirlpool") andras `label` och milstolparna nollstalls. `lastTriggeredRef` rensar dock inte, sa om en milstolpe i nasta fas har samma namn som en i foregaende fas, triggas den aldrig. Bor rensas nar `label` andras.

### 6. Test-klick i produktion
Rad 470-473 i `TimerFooter.tsx` innehaller en `onClick`-handler som triggar en test-alert nar man klickar pa totaltiden. Detta bor inte finnas i produktionskoden, speciellt inte pa TV:n dar oavsiktliga klick kan ske.

---

## Plan

### Steg 1: Utoka `TimerMilestone` med `acknowledged`
Lagg till `acknowledged?: boolean` i `TimerMilestone`-interfacet i bade:
- `src/hooks/use-external-timer.ts` (rad 6-10)
- `supabase/functions/sync-external-timer/index.ts` (rad 8-12)

### Steg 2: Parsa `acknowledged` i `fetchFromCache`
Uppdatera parsningen i `fetchFromCache` (rad 179-186) sa att `acknowledged` lases fran databasens JSON:
```typescript
acknowledged: typeof milestone.acknowledged === 'boolean' ? milestone.acknowledged : undefined,
```

### Steg 3: Ta bort typcasten i `TimerFooter.tsx`
Ersatt `(alertMilestone as any).acknowledged` med `alertMilestone.acknowledged` (rad 213).

### Steg 4: Ta bort dod kod (`fetchFromExternal`)
Ta bort hela `fetchFromExternal`-funktionen (rad 244-316) och tillhorande `externalSupabase`-import (rad 2) samt `useExternalAuth`-importen (rad 4) om den inte anvands pa annat hall.

### Steg 5: Rensa `lastTriggeredRef` vid fasbyte
Lagg till en `useEffect` som overvakar `timer.label` och rensar `lastTriggeredRef` och `triggeredAlert` nar fasen andras. Detta forhindrar att milstolpar "fastnar" mellan faser.

### Steg 6: Ta bort test-onClick
Ta bort `onClick`-handleren pa totaltids-elementet (rad 470-473) eller gor den villkorad till en debug/dev-flagga.

### Steg 7: Uppdatera kommentarer
Fixa kommentaren pa rad 198 fran "30+" till "120+" sekunder.

### Steg 8: Deploya edge-funktionen
Deploya den uppdaterade `sync-external-timer` sa att `acknowledged` tydligt ar en del av typen.

---

## Sammanfattning av filer som andras

| Fil | Andring |
|-----|---------|
| `src/hooks/use-external-timer.ts` | Lagg till `acknowledged` i typen, parsa det fran cache, ta bort `fetchFromExternal` och oanvanda imports |
| `src/components/TimerFooter.tsx` | Ta bort typcast, rensa `lastTriggeredRef` vid fasbyte, ta bort test-onClick, fixa kommentar |
| `supabase/functions/sync-external-timer/index.ts` | Lagg till `acknowledged` i `TimerMilestone`-interfacet |

