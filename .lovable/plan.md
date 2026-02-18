

# AI-analys av automationssystemet

## Sammanfattning
Automationen ar valbyggd med bra prioritering och sakerhet, men har ett **kritiskt problem** och nagra forbattringsmojligheter.

## KRITISKT: Dubbla korningar (Race Condition)

Triggern `automation_on_rapt_update` ar satt till `FOR EACH ROW`. Eftersom 3 controllers uppdateras vid varje RAPT-sync triggas `run-automation` **3 ganger parallellt**. Loggarna bekraftar detta:

```text
10:50:11 booted (time: 29ms)
10:50:11 booted (time: 28ms)
=> 4 decision logs vid 10:50
```

Detta kan leda till:
- Dubbla RAPT API-anrop (target setts tva ganger)
- Inkonsistent data mellan parallella korningar
- Onodiga AI-anrop (och kostnader)

### Fix
Andra triggern fran `FOR EACH ROW` till `FOR EACH STATEMENT` sa att orchestratorn bara kors **en gang** per sync-batch, oavsett hur manga controllers som uppdateras.

```sql
DROP TRIGGER IF EXISTS automation_on_rapt_update ON rapt_temp_controllers;

CREATE TRIGGER automation_on_rapt_update
  AFTER UPDATE ON rapt_temp_controllers
  FOR EACH STATEMENT
  EXECUTE FUNCTION trigger_automation_on_rapt_update();
```

Notera: `WHEN`-villkoret (old.last_update IS DISTINCT FROM new.last_update) stods inte med `FOR EACH STATEMENT`, men det behovs inte -- om inget andrats gors inget UPDATE alls.

## Forbattringsforslag

### 1. Stall-boost utan undo-mekanism
Nar stall detection hojer temperaturen (t.ex. +1 grader) finns ingen automatisk aterstallning nar jasningen aterupptas. Overshoot har recovery, men stall saknar det.

**Forslag**: Lagg till stall recovery-logik liknande overshoot recovery. Om jasningshastigheten atervander till normal (> threshold * 2 under 12h) och temperaturen hojts av stall, overag att sanka tillbaka.

**Bedomning**: Inte kritiskt -- stall-boost ar ofta onskad permanent. Kan implementeras senare om det visar sig behovas.

### 2. AI-optimering
Varje tank med stall/overshoot gor ett separat AI-anrop. Med 3 tankar kan det bli 3+ AI-anrop per cykel.

**Forslag**: Batcha alla tankar i ett enda AI-anrop med kontext for alla. Minskar latens och kostnad.

**Bedomning**: Bra optimering men inte kritiskt. Nuvarande totaltid ar ~15s vilket ar inom budget.

### 3. Cooling recovery kan oscillera
Glykolkylaren hojer gradvis (halva gapet) nar kylbehovet minskar. Om tanken sedan borjar kyla igen i nasta cykel, sanks kylaren, sedan hojs den igen, osv.

**Nuvarande skydd**: Check interval (t.ex. 60 min) forhindrar for snabba sankning. Men recovery sker varje cykel (var 5 min) utan interval-skydd.

**Forslag**: Lagg till en minsta tid sedan senaste cooling recovery (t.ex. 30 min) for att undvika oscillation.

### 4. Decision log storlek
Varje korning sparar hela decision log som JSONB. Med dubbla korningar och detaljerad loggning vaxer tabellen snabbt.

**Forslag**: Lagg till automatisk rensning (t.ex. behall senaste 7 dagars loggar via cron).

## Befintliga styrkor (ingen andring behovs)

- Prioriteringsordning (Stall > Overshoot > Cooling) ar korrekt
- Min/max per controller som absolut sakerhet fungerar val
- 30-min cooloff efter fermenteringsprofilsjustering ar bra
- adjusted_against_timestamp forhindrar dubbeljustering pa samma data
- Timeout-skydd per steg i orchestratorn ar robust
- Overshoot recovery (aterstallning till original_target) ar val implementerat
- Cooling floor (forhindrar att overshoot-prevention triggar kylning) ar kritiskt och korrekt

## Rekommenderad prioritering

| Prioritet | Andring | Komplexitet |
|---|---|---|
| 1 (Kritiskt) | Fixa FOR EACH ROW → FOR EACH STATEMENT | En migration |
| 2 (Bra att ha) | Cooling recovery interval-skydd | ~10 rader |
| 3 (Nice to have) | Decision log rensning | En cron-migration |
| 4 (Framtida) | Stall recovery | ~30 rader |
| 5 (Framtida) | AI-batchning | Storre refaktor |

