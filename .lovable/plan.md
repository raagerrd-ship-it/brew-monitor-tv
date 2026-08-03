# Full reglering på Pi: kyla och värme lokalt

Flytta hela reglerloopen — mätning, PID, PWM, kyla **och värme** — till Raspberry Pi:n (samma Pi som BLE-scannar). Molnet skickar bara **önskad temperatur** per tank. RAPT-controllern slutar vara aktuator helt.

Detta är en ändring mot tidigare version av planen, där molnet räknade duty och Pi:n bara var en dum aktuator. Att flytta hela loopen är bättre — motiveringen står nedan.

## Varför hela loopen, inte bara PWM

Om molnet räknar duty var 5:e minut och Pi:n bara verkställer, sitter vi fortfarande med:

- Reglercykel på 5 min trots att PT100 ger data varje sekund.
- Glykoltemperaturens svängningar måste kompenseras i förväg i molnet (ΔT-normalisering, mid-burst-vakt) — Pi:n ser dem direkt men får inte agera.
- Varje internetstörning eller cron-miss blir ett reglerhål.
- Två olika aktueringsvägar (kyla via PWM-hack, värme via RAPT-termostat) med olika latens och olika felmoder — svårt att resonera om lägesbyten.

Med loopen lokalt: PT100 1 Hz in, relä ut, ingen nätverkslatens i kritiska vägen. Molnet blir det den är bra på — profiler, historik, inlärning, UI, notiser.

## Ansvarsfördelning

```text
Moln                                Pi (lokalt)
  fermenteringsprofiler
  -> target_temp per tank    ->     pi_setpoint (pollas var 10:e s)
  lärda parametrar           ->     Kp/Kd/ff/dödtid per läge
                                    PID 1 Hz mot PT100
                                    lägesval kyla/värme
                                    PWM-fönster + reläer
  historik, inlärning, UI    <-     telemetri var 10:e s
```

**Molnet äger:** profilsteg och rampning, målvärde, lärda parametrar, all loggning/graf/notiser, UI.

**Pi:n äger:** mätning (PT100), PID mot målet, lägesval kyla/värme, PWM-fönster, reläer, glykolhysteres, all säkerhet i realtid.

**RAPT:** kvar som Pill-källa och som reservväg tills Pi-vägen är bevisad.

## Så här fungerar Pi-loopen

- Läser PT100 var 1:a sekund, filtrerar lätt (2–3 min EMA räcker när sensorn sitter direkt på tanken).
- PID: `duty = ff + trimI + Kp·fel − Kd·temphastighet`. Samma formel som molnets V6 — porteras rakt av till Python, inte omskriven.
- Lägesval kyla/värme med samma tvåstegs-hysteres som idag (neutralband, tidsvillkorad flip, direkt flip vid stort fel) plus 1-timmarslatchen — men nu lokalt på färsk sensordata i stället för på 5-minuterscykel.
- Kyl- och värmerelä kan aldrig vara på samtidigt (hårt interlock), och det krävs en minsta paus vid lägesbyte.
- ΔT-kompensation lokalt: on-tiden skalas mot aktuell glykoltemperatur, så samma kyleffekt levereras vare sig glykolen står på 8° eller 2°. Detta ersätter både ΔT-normaliseringen och mid-burst-glykolvakten i molnet.
- PWM-fönster default **180 s (3 min)**, konfigurerbart per tank och per läge. Värmen kan gå med kortare fönster eftersom den inte har pumpens tryckuppbyggnad.
- **Minsta på-tid 5 s för kyla** — pumpen behöver bygga tryck. Kortare begärd on-tid ackumuleras i en `duty_debt`-räknare och levereras som en 5-sekunderspuls när skulden räcker till.
- **Minsta av-tid 5 s** — ingen kortcykling. Ett för kort av-brott förlängs till 5 s och överskottet dras från nästa fönster.
- Glykolreläet: enkel hysteres på glykol-PT100 (t.ex. på under 7°, av vid 4°).

## Säkerhet

- Målvärdet har `expires_at`. Tappar Pi:n internet kör den vidare på senaste målet i 6 timmar — den kan det, för den har både sensor och regulator lokalt. Därefter säkert viloläge: allt av.
- Hårda gränser lokalt: min/max tillåten tanktemp, max sammanhängande on-tid per relä, max duty. Överskrids något bryts reläet oavsett vad PID säger.
- Värmen har en egen övertemperaturspärr (hårt tak) och kräver färsk sensordata — ingen PT100-avläsning på 60 s betyder värme av.
- Watchdog i molnet: larmar om ingen telemetri på 2 min.
- Molnet kan alltid tvinga stopp genom att sätta duty-tak 0 i setpoint-raden.

## Etapper

**Etapp 1 — mätning först**
- PT100 + MAX31865 monteras, Pi:n rapporterar temperaturer till molnet. Ingen styrning ännu.
- Nya tabeller: `pi_probe_readings`, `pi_relay_state`.
- Ny edge-funktion `pi-telemetry` (POST), autentiserad med `x-pi-secret` mot befintlig `PI_BLE_INGEST_SECRET`.
- Vi jämför PT100 mot Pill/probe i några dygn och ser hur stor sensorlatensen faktiskt varit.

**Etapp 2 — kyla via relä, PID på Pi**
- Ny tabell `pi_setpoint`: per controller `target_temp`, `mode_allowed`, `max_duty_pct`, `pwm_period_s` (180), `min_on_s` (5), `min_off_s` (5), `params` (JSONB med lärda värden per läge), `expires_at`.
- Ny edge-funktion `pi-control` (GET): Pi hämtar målvärde + parametrar.
- Ny kolumn på `rapt_temp_controllers`: `actuation` = `rapt` eller `pi`. En tank i taget flyttas över.
- `auto-adjust-cooling` skriver målvärde till `pi_setpoint` för Pi-tankar i stället för att räkna duty och manipulera RAPT-mål.
- Inlärning körs fortfarande i molnet, men på telemetri från Pi:n (faktiskt levererad on-tid, inte begärd).
- Värmen går fortfarande via RAPT här, så vi byter en sak i taget.

**Etapp 3 — värme på Pi**
- Värmeelementen flyttas till Pi-reläerna och Pi:n tar över lägesvalet helt.
- RAPT-controllerns egen termostat neutraliseras (mål långt utanför arbetsområdet) så den aldrig kan slå till parallellt.

**Etapp 4 — PT100 som SSOT och rensning**
- `actual_temp` byts till PT100 för Pi-tankar. Lärda `dead_time_hours` och `process_gain` nollställs — de är inlärda på en 15 min långsammare sensor.
- För Pi-tankar tas bort ur molnkoden: `execute-pwm-off`-cronen, orphan-extreme-vakten, PWM-OFF-bekräftelse och read-back, mid-burst-glykolvakten, PWM-dithering/slot-rotation, `subTenMinGapSlots`-clampen och burstlängdsberäkningarna.
- Allt detta finns bara för att kompensera för RAPT-hacket. Med reläer försvinner grundproblemet, inte bara symptomen.
- RAPT-vägen ligger kvar orörd så länge någon tank står på `actuation = 'rapt'`.

## Hårdvara

- 3 reläer för cirkulationspumpar — kyla per tank (Blå, Gul, Grön)
- 3 reläer för värmeelement/värmematta — värme per tank
- 1 relä för glykolkylaren
- 4 st PT100 med MAX31865 — en per tank plus en i glykoltanken

Behöver veta vad värmen är för typ idag (matta, doppvärmare, effekt i W) och om den sitter i RAPT:s uttag — den måste flyttas till Pi-reläet.

## UI

- Relästatus per tank i controller-kortet: pump-ikon för kyla, värmeikon för värme, lyser vid on-fas.
- PT100-temperatur bredvid Pill/probe i sensorraden.
- Växel per controller i inställningar: styrning via RAPT eller Pi.
- Duty och PID-termer visas som idag, men läses från Pi-telemetrin.

## Vad du behöver göra på Pi:n

Pi-koden levereras som ett Python-projekt under `pi/` i det här repot (samma mönster som `pi/brew-ble`): PID-loop, MAX31865-avläsning, relästyrning med interlock, poll/rapport, failsafe, systemd-unit. Jag behöver veta relämodulens typ (aktiv hög/låg) och vilka GPIO-pinnar som är lediga bredvid BLE-scannern.

## Teknisk detalj

- Två edge-funktioner totalt: `pi-control` (GET setpoint + params) och `pi-telemetry` (POST temperaturer, relästatus, levererad on-tid per läge, PID-termer).
- Pi:n pratar aldrig direkt med databasen — bara genom dessa två.
- RLS: `pi_setpoint`, `pi_probe_readings`, `pi_relay_state` läsbara för `authenticated`, skrivbara endast via `service_role`.
- PID-koden portas från `pid-compensation-claude.ts` till Python med bevarad struktur och parameternamn, så en bugg fixad på ena sidan går att spegla på den andra.
- Enda risken värd att nämna: vi får två implementationer av samma reglerlogik. Därför flyttas bara *reglersteget* — inlärningen stannar i molnet och Pi:n får sina parametrar därifrån.
