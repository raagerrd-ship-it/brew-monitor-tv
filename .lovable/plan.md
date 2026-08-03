# Pi-styrd kyla: hela reglerloopen lokalt

Flytta både PWM-motorn **och** PID-regleringen till Raspberry Pi:n (samma Pi som BLE-scannar). Molnet skickar bara **önskad temperatur** per tank. Värmen ligger kvar på RAPT tills vidare.

Detta är en ändring mot tidigare version av planen, där molnet räknade duty och Pi:n bara var en dum aktuator. Att flytta hela loopen är bättre — motiveringen står nedan.

## Varför hela loopen, inte bara PWM

Om molnet räknar duty var 5:e minut och Pi:n bara verkställer, sitter vi fortfarande med:

- Reglercykel på 5 min trots att PT100 ger data varje sekund.
- Glykoltemperaturens svängningar måste kompenseras i förväg i molnet (ΔT-normalisering, mid-burst-vakt) — Pi:n ser dem direkt men får inte agera.
- Varje internetstörning eller cron-miss blir ett reglerhål.

Med loopen lokalt: PT100 1 Hz in, relä ut, ingen nätverkslatens i kritiska vägen. Molnet blir det den är bra på — profiler, historik, inlärning, UI, notiser.

## Ansvarsfördelning

```text
Moln                                Pi (lokalt)
  fermenteringsprofiler
  -> target_temp per tank    ->     pi_setpoint (pollas var 10:e s)
  lärda parametrar           ->     Kp/Kd/ff/dödtid
                                    PID 1 Hz mot PT100
                                    PWM-fönster + reläer
  historik, inlärning, UI    <-     telemetri var 10:e s
  <- värme via RAPT (oförändrat)
```

**Molnet äger:** profilsteg och rampning, målvärde, lärda parametrar, all loggning/graf/notiser, värmestyrning via RAPT.

**Pi:n äger:** mätning (PT100), PID mot målet, PWM-fönster, reläer, glykolhysteres, all säkerhet i realtid.

## Så här fungerar Pi-loopen

- Läser PT100 var 1:a sekund, filtrerar lätt (2–3 min EMA räcker när sensorn sitter direkt på tanken).
- PID: `duty = ff + trimI + Kp·fel − Kd·temphastighet`. Samma formel som molnets V6 — porteras rakt av till Python, inte omskriven.
- ΔT-kompensation lokalt: on-tiden skalas mot aktuell glykoltemperatur, så samma kyleffekt levereras vare sig glykolen står på 8° eller 2°. Detta ersätter både ΔT-normaliseringen och mid-burst-glykolvakten i molnet.
- PWM-fönster default **180 s (3 min)**, konfigurerbart per tank.
- **Minsta på-tid 5 s** — pumpen behöver bygga tryck. Kortare begärd on-tid ackumuleras i en `duty_debt`-räknare och levereras som en 5-sekunderspuls när skulden räcker till.
- **Minsta av-tid 5 s** — ingen kortcykling. Ett för kort av-brott förlängs till 5 s och överskottet dras från nästa fönster.
- Glykolreläet: enkel hysteres på glykol-PT100 (t.ex. på under 7°, av vid 4°).

## Säkerhet

- Målvärdet har `expires_at`. Tappar Pi:n internet kör den vidare på senaste målet i 6 timmar — den kan det, för den har både sensor och regulator lokalt. Därefter går den till ett säkert viloläge (kyla av).
- Hårda gränser lokalt: min/max tillåten tanktemp, max sammanhängande on-tid, max duty. Överskrids något stängs reläet oavsett vad PID säger.
- Watchdog i molnet: larmar om ingen telemetri på 2 min.
- Molnet kan alltid tvinga stopp genom att sätta duty-tak 0 i setpoint-raden.

## Etapper

**Etapp 1 — mätning först**
- PT100 + MAX31865 monteras, Pi:n rapporterar temperaturer till molnet. Ingen styrning ännu.
- Nya tabeller: `pi_probe_readings`, `pi_relay_state`.
- Ny edge-funktion `pi-telemetry` (POST), autentiserad med `x-pi-secret` mot befintlig `PI_BLE_INGEST_SECRET`.
- Vi jämför PT100 mot Pill/probe i några dygn och ser hur stor sensorlatensen faktiskt varit.

**Etapp 2 — kyla via relä, PID på Pi**
- Ny tabell `pi_setpoint`: per controller `target_temp`, `mode`, `max_duty_pct`, `pwm_period_s` (180), `min_on_s` (5), `min_off_s` (5), `params` (JSONB med lärda värden), `expires_at`.
- Ny edge-funktion `pi-control` (GET): Pi hämtar målvärde + parametrar.
- Ny kolumn på `rapt_temp_controllers`: `cool_actuation` = `rapt` eller `pi`. En tank i taget flyttas över.
- `auto-adjust-cooling` skriver målvärde till `pi_setpoint` för Pi-tankar i stället för att räkna duty och manipulera RAPT-mål.
- Inlärning körs fortfarande i molnet, men på telemetri från Pi:n (faktiskt levererad on-tid, inte begärd).

**Etapp 3 — PT100 som SSOT och rensning**
- `actual_temp` byts till PT100 för Pi-tankar. Lärda `dead_time_hours` och `process_gain` nollställs — de är inlärda på en 15 min långsammare sensor.
- För Pi-tankar tas bort ur molnkoden: `execute-pwm-off`-cronen, orphan-extreme-vakten, PWM-OFF-bekräftelse och read-back, mid-burst-glykolvakten, PWM-dithering/slot-rotation, `subTenMinGapSlots`-clampen och burstlängdsberäkningarna.
- Allt detta finns bara för att kompensera för RAPT-hacket. Med reläer försvinner grundproblemet, inte bara symptomen.
- RAPT-vägen ligger kvar orörd så länge någon tank står på `cool_actuation = 'rapt'`.

## Hårdvara

- 3 reläer för cirkulationspumpar (Blå, Gul, Grön), ett fjärde för glykolkylaren.
- 4 st PT100 med MAX31865 — en per tank plus en i glykoltanken.

## UI

- Relästatus per tank i controller-kortet (pump-ikon som lyser vid on-fas).
- PT100-temperatur bredvid Pill/probe i sensorraden.
- Växel per controller i inställningar: kyla via RAPT eller Pi.
- Duty och PID-termer visas som idag, men läses från Pi-telemetrin.

## Vad du behöver göra på Pi:n

Pi-koden levereras som ett Python-projekt under `pi/` i det här repot (samma mönster som `pi/brew-ble`): PID-loop, MAX31865-avläsning, relästyrning, poll/rapport, failsafe, systemd-unit. Jag behöver veta relämodulens typ (aktiv hög/låg) och vilka GPIO-pinnar som är lediga bredvid BLE-scannern.

## Teknisk detalj

- Två edge-funktioner totalt: `pi-control` (GET setpoint + params) och `pi-telemetry` (POST temperaturer, relästatus, levererad on-tid, PID-termer).
- Pi:n pratar aldrig direkt med databasen — bara genom dessa två.
- RLS: `pi_setpoint`, `pi_probe_readings`, `pi_relay_state` läsbara för `authenticated`, skrivbara endast via `service_role`.
- PID-koden portas från `pid-compensation-claude.ts` till Python med bevarad struktur och parameternamn, så en bugg fixad på ena sidan går att spegla på den andra.
- Enda risken värd att nämna: vi får två implementationer av samma reglerlogik. Därför flyttas bara *reglersteget* — inlärningen stannar i molnet och Pi:n får sina parametrar därifrån.
