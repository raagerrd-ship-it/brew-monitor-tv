

## PWM per 5-minuterscykel (burst-modell)

### Koncept

Nuvarande modell delar upp en timme i 12 segment (5 min var) och bestämmer om hela segmentet är "på" eller "av". Det ger grov granularitet — antingen 5 min kylning eller 0.

Ny modell: varje 5-minuterscykel gör en **kort burst** proportionell mot duty cycle. Vid 22% duty = 66 sekunder aktiv kylning, sedan av resten av cykeln. Minimum 30 sekunder.

```text
Nuvarande (12-segment/timme):
|████|    |    |████|    |    |████|    |    |████|    |    |
 5min                                                  60min

Ny (burst per cykel):
|█|   |█|   |█|   |█|   |█|   |█|   |█|   |█|   |█|   ...
 66s   66s   66s   ...                                  varje 5 min
```

### Teknisk utmaning: "Av"-kommandot

Edge-funktionen körs en gång per 5 minuter. Den kan skicka "på"-kommandot, men måste också skicka "av"-kommandot efter duty-tiden. Tre alternativ:

**A) Sleep i funktionen** — Funktionen väntar (`await sleep(dutyMs)`) innan den skickar av-kommandot. Problemet: `run-automation` har 20s timeout på anropet till `auto-adjust-cooling`, och duty kan vara 66+ sekunder.

**B) Tvåfas via DB-timestamp** — Spara `pwm_off_at` i DB. En separat funktion (eller pg_cron varje minut) kollar och stänger av. Ger ~1 min granularitet — för grovt för 30s minimum.

**C) Fire-and-forget med fördröjd fetch (rekommenderad)** — Funktionen skickar "på"-kommandot, startar en bakgrunds-fetch till en liten `pwm-deactivate` edge function med en `delay_ms` parameter som sover och sedan stänger av. Huvudfunktionen returnerar direkt.

### Rekommendation: Alternativ A med omstrukturering

Enklast och mest pålitligt. Vi gör följande:

1. **PWM-logiken körs EFTER att `auto-adjust-cooling` returnerat** — separera PWM-burst till ett eget steg i `run-automation`
2. `auto-adjust-cooling` returnerar PWM-metadata (controllerId, duty_seconds, on-target, off-target) i sitt svar
3. `run-automation` kör PWM-bursten som ett eget steg: skickar "på" via RAPT API, `await sleep(duty_seconds * 1000)`, skickar "av"
4. `run-automation` har ingen strikt timeout på detta steg (eller hög timeout)

### Teknisk plan

**1. `controller-adjustments.ts`** — Ändra PWM-logiken:
- Istället för att skicka on/off-target direkt, returnera PWM-metadata i resultatet
- Ta bort 12-segment/timme-beräkningen
- Beräkna `duty_seconds = max(30, round(duty_pct * 300))`
- Cap duty_seconds vid 240 (80% av 300s, lämnar margin för API-latens)

**2. `auto-adjust-cooling/index.ts`** — Returnera PWM-actions i response:
- Om PWM-burst behövs: inkludera `{ pwm_bursts: [{ controller_id, on_target, off_target, duty_seconds }] }` i JSON-svaret

**3. `run-automation/index.ts`** — Nytt steg 3b: PWM Burst:
- Läs `pwm_bursts` från auto-adjust-cooling-svaret
- För varje burst: skicka on-target till RAPT API, sleep, skicka off-target
- Kör detta parallellt med health check (steg 4)

**4. DB: `pwm_stable_count` behålls** — ingen schemaändring

**5. Beslutslogg:**
- `DUTY_PWM_BURST`: "22% duty → 66s burst av 300s (min 30s)"
- `DUTY_PWM_OFF`: "Burst klar, återställer mål"

### Filer som ändras

- `supabase/functions/_shared/controller-adjustments.ts` — PWM-logik → returnerar metadata istf direkta API-anrop
- `supabase/functions/auto-adjust-cooling/index.ts` — propagerar PWM-metadata i response
- `supabase/functions/run-automation/index.ts` — nytt PWM-burst-steg med sleep

