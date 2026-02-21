

# Ersatt AI-anrop med deterministisk logik

## Bakgrund

Analysen visar att AI-anropen ger minimalt mervarde:

- **Stall**: AI:n returnerar oftast "raise_temp +1C" eller "wait". Fallback-logiken gor redan samma sak med en fast boost.
- **Overshoot**: Koden **ignorerar AI:ns temperaturvarde** och beraknar istallet en deterministisk midpoint-formel. AI:n fungerar bara som en "gate" (confidence >= 50).

Bada scenarierna har redan full fallback-logik som kopierar exakt vad AI:n brukar gora.

## Forandringar

### 1. Stall Detection -- ersatt AI med stilbaserad boost

Nuvarande flode:
1. Samla stall-kandidater
2. Anropa AI batched
3. Om AI sager raise_temp med confidence >= 50, anvand AI:ns newTargetTemp
4. Annars fallback: fast boost (+auto_boost_degrees)

Nytt flode:
1. Samla stall-kandidater (oforandrat)
2. For varje kandidat, tillhampa direkt boost med style-baserad logik:
   - Lager/Pilsner: +0.5C (kannsligare stil)
   - Standard (ale, etc): +auto_boost_degrees (default 1C)
   - Belgisk/Saison: +1.5C (talligare stil)
3. Tidvakt: max en boost per 12 timmar per controller (forhindrar upprepade hopp)
4. Samma granscheck som idag: max_target_temp, progress < 95%, sgToFg > 0.005

### 2. Overshoot Prevention -- ta bort AI-gate

Nuvarande flode:
1. Samla overshoot-kandidater
2. Anropa AI batched
3. Om AI sager pause_heating/lower_temp med confidence >= 50:
   - Berakna midpoint = (ctrlTemp + originalTarget) / 2
   - coolingFloor = ctrlTemp + hysteresis + 0.1
   - newTarget = max(midpoint, coolingFloor)
4. Annars fallback: enkel sankning

Nytt flode:
1. Samla overshoot-kandidater (oforandrat)
2. Tillhampa midpoint-formeln direkt utan AI-gate (exakt samma berakning som idag)
3. Logga tydligt vad som hande

### 3. Ta bort AI-anropet helt

- All AI-kontextsamling (deltaHistory, tempHistory, hoursAtCurrentTemp for AI) tas bort fran bade stall och overshoot
- `aiContext`-objekten byggs inte langre
- `supabase.functions.invoke('ai-fermentation-advisor')` anropas aldrig
- Fallback-kodvagar (3 duplicerade block per feature) forsvinner -- ersatts av EN kodvag

### 4. Behall ai-fermentation-advisor edge function

Funktionen tas inte bort -- den kan fortfarande anvandas manuellt eller i framtiden. Vi tar bara bort det automatiska anropet fran auto-adjust-cooling.

## Teknisk sammanfattning

Filen `supabase/functions/auto-adjust-cooling/index.ts` andras:

**Stall Detection (raderna ~380-720):**
- Ta bort stallCandidates-array, aiContext-samling, Phase 2 (AI-anrop), Phase 3 (applicering), alla fallback-block
- Ersatt med inline deterministisk logik direkt i loopen: stilbaserad boost + tidvakt + samma granscheck

**Overshoot Prevention (raderna ~726-1050):**
- Ta bort overshootCandidates-array, aiContext-samling, Phase 2 (AI-anrop), fallback-block
- Ersatt med inline deterministisk midpoint-berakning direkt i loopen

**Resultat:**
- ~300-400 rader mindre kod (3 kodvagar per feature blir 1)
- 0 AI-anrop per cykel (var 2 st)
- 2-5 sekunder snabbare per cykel
- Inga rate-limit eller kredit-problem
- 100% forutsagbart beteende

## Stilbaserade boost-grader

```text
Stil (matchas via regex)     Boost
--------------------------   -----
lager, pilsner, kolsch       +0.5C
belgian, saison, farmhouse   +1.5C
ovriga (ale, stout, etc)     +auto_boost_degrees (default 1.0C)
```

## Tidvakt for stall

En controller far max boostas en gang per 12 timmar. Kontrolleras via senaste `auto_cooling_adjustments` med reason som borjar pa "Jäsning stannat" for den controllern.

