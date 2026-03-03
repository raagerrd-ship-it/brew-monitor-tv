

## RAPT-avbrottsscenarier — Analys av cooler-management.ts

Jag har gått igenom hela flödet med fokus på vad som händer när RAPT API:et eller RAPT-hårdvaran går ner i olika faser.

---

### Scenario A: RAPT API nere under normal justering (batch flush)

**Flöde:** `runCoolerCooling` beräknar nytt mål → `applyCoolerTarget` lägger till i `updateBatch` → `flush()` anropar RAPT API → **timeout/500-fel** → `batchResults` visar `false` för controllern.

**Vad händer:** Loggas som `BATCH_FLUSH fail`. DB-uppdateringen (rad 497-510) körs bara för succeeded-entries, så **databasen behåller det gamla målet**. Nästa cykel (5 min) beräknar samma diff och försöker igen.

**Risk:** Ingen. Kylaren stannar på sitt senaste fungerande mål. Om det var rätt mål sedan innan — ingen effekt. Om tanken behöver lägre temp — max 5 min fördröjning per försök.

**Bedömning: STABIL** ✅

---

### Scenario B: RAPT API nere under hysteresis-kick

**Flöde:** Kick-logiken kör `applyCoolerTarget` (som returnerar `true` för batched, men flush misslyckas) → DB-flaggan `hysteresis_kick_active = true` sätts.

**Problem:** Med batch-flödet returnerar `applyCoolerTarget` alltid `true` (rad 968-970) så länge `ctx.updateBatch` finns. Flaggan sätts FÖRE flush. Om flush sedan misslyckas:
- DB har `hysteresis_kick_active = true`
- Hårdvaran har det gamla målet
- Nästa cykel: `previousWasKick = true` → rensar flaggan → faller igenom till normal apply

**Risk:** En bortslösad cykel (5 min), men ingen farlig situation. Kick-stuck guard (rad 232-239) fångar eventuella kvarvarande problem.

**Men — detta är ett designfel:** `applyCoolerTarget` returnerar `true` för batched updates utan att veta om flush lyckas. DB-flaggan borde sättas efter flush, inte efter queue.

**Bedömning: MINOR DESIGNFEL** ⚠️

---

### Scenario C: RAPT-hårdvaran offline (inga sensoruppdateringar)

**Flöde:** `last_update` slutar uppdateras. Efter 30 min: stale sensor guard (rad 92-101) triggas → `COOLER_STALE` → return tidigt.

**Vad händer:** Hela cooler-management avbryts. Kylaren behåller sitt senaste mål från hårdvaran.

**Risk:** Om kylaren var i idle (högt mål) när den gick offline — inget problem. Om den var i aktiv kylning — den fortsätter kyla med det senaste hardware-målet. Tankar skyddas av sina egna hysteresis-inställningar.

**Bedömning: STABIL** ✅ (men ingen recovery-åtgärd — kylaren kan sitta fast på ett gammalt mål tills RAPT kommer tillbaka)

---

### Scenario D: RAPT API nere under kick-revert

**Flöde:** Kick lyckades förra cykeln → `previousWasKick = true` → flagga rensas → normal apply → flush misslyckas.

**Vad händer:** Flaggan är redan rensad (rad 228-230). Hårdvaran sitter kvar på kick-target (minTemp - 1). Nästa cykel: `previousWasKick = false`, `currentCoolerTarget ≈ minTemp - 1` → **kick-stuck guard** (rad 232-239) triggas → nytt försök att applicera clampedTarget.

**Risk:** Kylaren kyler maximalt under 1-2 extra cykler (5-10 min). Tankens egen hysteresis förhindrar att ölen skadas.

**Bedömning: STABIL** ✅

---

### Scenario E: RAPT API går ner MITT UNDER en ramp (cold crash)

**Flöde:** Profilen sänker mål steg för steg. API-anrop misslyckas upprepat.

**Vad händer:** Kylaren behåller sitt senaste lyckade mål. Tankarnas PID-kompensation slutar också fungera (samma batch). Hårdvaran kör på sitt senaste mål → tanken kyler (eller inte) baserat på senaste hardware-target.

**Risk:** Om det senaste lyckade målet var högre än vad cold crash behöver → tanken kyler långsammare. Men tanken har sin egen kylkrets med hysteresis som fortsätter fungera oberoende av automationen.

**Bedömning: STABIL** ✅ (graceful degradation)

---

### Scenario F: RAPT API intermittent (fungerar ibland)

**Flöde:** Varannan flush lyckas, varannan misslyckas.

**Vad händer:** Lyckade flushes uppdaterar DB. Misslyckade flushes lämnar DB orörd. Nästa cykel läser DB-värdet (som speglar senaste lyckade flush) och beräknar diff mot det.

**Risk:** Oscillation möjlig men begränsad av rate-limit (5 min) och relay-aware no-op guard.

**Bedömning: STABIL** ✅

---

### Identifierat problem: Batch + kick-flagga

Det enda reella problemet:

**`applyCoolerTarget` returnerar alltid `true` vid batch-läge** (rad 968-970), men det faktiska API-anropet sker först vid `flush()`. Kick-flaggan `hysteresis_kick_active` sätts baserat på denna tidiga `true`, vilket innebär att vid flush-fel:
1. DB-flaggan står som `true` 
2. Hårdvaran fick aldrig kicken
3. Nästa cykel "revertar" en kick som aldrig hände

**Konsekvens:** Inte farligt (kick-stuck guard fångar det om det eskalerar), men det slösar 1-2 cykler.

### Rekommenderad fix

Flytta kick-flaggans `hysteresis_kick_active = true` till **efter batch flush** i `auto-adjust-cooling/index.ts`, genom att kontrollera `batchResults` för coolern. Alternativt: skicka kick-uppdateringar direkt (`setControllerTargetTemp`) istället för via batch, eftersom kicks är tidskritiska.

---

### Sammanfattning

| Scenario | Status | Risk |
|---|---|---|
| API nere under normal justering | ✅ Stabil | Ingen |
| API nere under kick | ⚠️ Minor | 1-2 bortslösade cykler |
| Hårdvara offline (stale) | ✅ Stabil | Kylare fastnar på senaste mål |
| API nere under kick-revert | ✅ Stabil | Kick-stuck guard fångar |
| API nere under ramp/cold crash | ✅ Stabil | Graceful degradation |
| Intermittent API | ✅ Stabil | Rate-limit skyddar |

**En åtgärd rekommenderas:** Fixa kick-flaggans timing relativt batch flush.

