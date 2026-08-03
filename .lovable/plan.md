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
  historik, inlärning, UI    <-     snabbsynk 10 s / full synk 60 s
```

**Molnet äger:** profilsteg och rampning, målvärde, lärda parametrar, all loggning/graf/notiser, UI.

**Pi:n äger:** mätning (PT100), PID mot målet, lägesval kyla/värme, PWM-fönster, reläer, glykolhysteres, all säkerhet i realtid.

**Pill/SG:** kommer från BLE-sniffern som redan kör på samma Pi (`pi/brew-ble` → `ingest-pill-ble`), inte från RAPT Cloud. SG och pill-temp går alltså lokalt hela vägen.

**RAPT Cloud:** bara reservväg tills Pi-vägen är bevisad. När kyla, värme, tanktemp (PT100) och SG (BLE) alla går via Pi:n finns inget kvar som kräver RAPT:s moln-API i löpande drift.

## Så här fungerar Pi-loopen

- Läser PT100 var 1:a sekund, filtrerar lätt (2–3 min EMA räcker när sensorn sitter direkt på tanken).
- PID: `duty = ff + trimI + Kp·fel − Kd·temphastighet`. Samma formel som molnets V6 — porteras rakt av till Python, inte omskriven.
- Lägesval kyla/värme med samma tvåstegs-hysteres som idag (neutralband, tidsvillkorad flip, direkt flip vid stort fel) plus 1-timmarslatchen — men nu lokalt på färsk sensordata i stället för på 5-minuterscykel.
- Kyl- och värmerelä kan aldrig vara på samtidigt (hårt interlock), och det krävs en minsta paus vid lägesbyte.
- ΔT-kompensation lokalt: on-tiden skalas mot aktuell glykoltemperatur, så samma kyleffekt levereras vare sig glykolen står på 8° eller 2°. Detta ersätter både ΔT-normaliseringen och mid-burst-glykolvakten i molnet.
- PWM-fönster default **180 s (3 min)**, konfigurerbart per tank och per läge.
- **Minsta på-tid 5 s och minsta av-tid 5 s — gäller både kyla och värme.** För kylan behöver pumpen bygga tryck i ledningen; för värmen undviker vi kortcykling av reläet och elementet. Samma regel, samma kod, båda lägena.
- Kortare begärd on-tid än 5 s körs inte som en stympad puls utan ackumuleras i en `duty_debt`-räknare (en per läge) och levereras som en 5-sekunderspuls när skulden räcker till. Ett av-brott kortare än 5 s förlängs till 5 s och överskottet dras från nästa fönster.
- Båda tiderna är konfigurerbara per tank och per läge (`min_on_s` / `min_off_s`) om det visar sig att värmen tål eller behöver andra värden.
- Glykolreläet: enkel hysteres på glykol-PT100 (t.ex. på under 7°, av vid 4°).

## Tvådelad synk mot molnet

Regleringen behöver inte molnet alls, så synkens enda syfte är UI-färskhet, historik och inlärning. Därför delas den i två nivåer i stället för en tung rapport med hög frekvens.

**Snabbsynk — var 30:e sekund, litet paket**
- Bara det som ska kännas levande i UI:t: tanktemp (PT100), glykoltemp, aktuellt läge, aktuell duty, relä på/av.
- Skrivs till en singleton-rad per controller (`pi_live_state`) med UPSERT — ingen historikrad, ingen tillväxt i databasen. UI:t prenumererar via realtime och känns direkt.
- Samma anrop bär också Pi:ns heartbeat, så watchdog-larmet (2 min utan kontakt) hänger på snabbsynken.
- Setpoint-hämtningen piggybackar på svaret: Pi:n skickar sin nuvarande setpoint-version, molnet svarar med nytt målvärde/parametrar bara när något ändrats. Alltså ingen separat poll.
- 30 s är tillräckligt färskt: jäsningstempen rör sig ~0,3 °C/h, watchdogen (2 min) fångar ändå 4 missade pulser, och setpoint-fördröjningen är försumbar mot tankens dödtid. DB-skrivningar blir 2 880/tank/dygn i stället för 8 640.

**Full synk — var 5:e minut, aggregerat**
- Det som behövs för historik, grafer och inlärning: min/medel/max tanktemp under perioden, faktiskt levererad on-tid per läge (sekunder), PID-termer (ff, trimI, P, D), antal reläslag, glykol min/max.
- Skrivs som en historikrad. 288 rader/dygn och tank — samma takt som dagens `temp_controller_history` och `brew_data_snapshots`, så grafer och inlärning ser ut som idag.
- Aggregat i stället för stickprov gör inlärningen *bättre*, inte sämre: levererad on-tid mäts i Pi:n med sekundupplösning i stället för att gissas ur ett stickprov.

**Vid nätavbrott**
- Snabbsynken bara droppas — den är färskvara, gammal live-status har inget värde.
- Full synk köas lokalt i SQLite (samma mönster som `pi/brew-ble/uploader.py` med `synced`-flagga) och töms i batch när kontakten är tillbaka. Ingen historik går förlorad.

Om 10 s visar sig vara onödigt tätt för UI-känslan går snabbsynken att glesa till 15–30 s utan att något annat påverkas — den är frikopplad från regleringen.

## Säkerhet

- **Internetbortfall stänger inte av något.** Pi:n har sensor, regulator och aktuator lokalt, så den fortsätter hålla senaste målet hur länge som helst. Att slå av allt mitt i en jäsning vore farligare än att hålla ett något gammalt målvärde — en tank som driftar fritt förstör batchen, ett fruset målvärde gör det inte.
- Målvärdet sparas persistent på disk så det överlever en omstart av Pi:n under avbrottet.
- `expires_at` blir därför bara en informationsflagga: Pi:n loggar och rapporterar "setpoint stale" (och visar det i UI:t när kontakten är tillbaka), men fortsätter reglera. Vill du kunna tvinga fram avstängning finns molnets `max_duty_pct = 0` — men den kräver ju kontakt, så den är inte en failsafe utan ett manuellt stopp.
- Det som *ska* stänga av är lokala fel, inte molnfel: sensorbortfall, temperatur utanför hårda gränser, eller relä som stått på för länge. Se punkterna nedan.
- Enda undantaget värt att bevaka: en profil som skulle ha rampat vidare står stilla under avbrottet. Vi larmar när kontakten återkommer och molnet räknar då om steget mot faktisk tid, i stället för att hoppa i temperatur.
- Hårda gränser lokalt: min/max tillåten tanktemp, max sammanhängande on-tid per relä, max duty. Överskrids något bryts reläet oavsett vad PID säger.
- Värmen har en egen övertemperaturspärr (hårt tak) och kräver färsk sensordata — ingen PT100-avläsning på 60 s betyder värme av.
- Sensorbortfall: ingen giltig PT100-avläsning på 60 s → båda reläerna av. Här är avstängning rätt svar, för då reglerar vi blint.
- Watchdog i molnet: larmar om ingen telemetri på 2 min (nu ett *kommunikations*larm, inte en anledning att stoppa regleringen).

## Etapper

**Etapp 1 — mätning först**
- PT100 + MAX31865 monteras, Pi:n rapporterar temperaturer till molnet. Ingen styrning ännu.
- Nya tabeller: `pi_live_state` (singleton per controller, UPSERT från snabbsynken) och `pi_probe_readings` (aggregerade minutrader från full synk).
- Ny edge-funktion `pi-telemetry` (POST), autentiserad med `x-pi-secret` mot befintlig `PI_BLE_INGEST_SECRET`. Tar emot båda synknivåerna; fältet `kind` (`live` eller `rollup`) avgör vilken väg som körs.
- Vi jämför PT100 mot Pill/probe i några dygn och ser hur stor sensorlatensen faktiskt varit.
- BLE-sniffern rör vi inte — den kör redan och matar `ingest-pill-ble`.

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
- `sync-rapt-data-quick` behöver inte längre hämta controller-temperaturer för Pi-tankar. RAPT-synken glesas ut till det som fortfarande behövs, och kan stängas av helt när sista tanken flyttats.
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

- Två edge-funktioner totalt: `pi-control` (GET setpoint + params, som fallback när piggyback inte används) och `pi-telemetry` (POST, både snabbsynk och 5-minutsaggregat; svarar med ny setpoint när `setpoint_version` skiljer sig).
- Pi:n pratar aldrig direkt med databasen — bara genom dessa två.
- RLS: `pi_setpoint`, `pi_probe_readings`, `pi_relay_state` läsbara för `authenticated`, skrivbara endast via `service_role`.
- PID-koden portas från `pid-compensation-claude.ts` till Python med bevarad struktur och parameternamn, så en bugg fixad på ena sidan går att spegla på den andra.
- Enda risken värd att nämna: vi får två implementationer av samma reglerlogik. Därför flyttas bara *reglersteget* — inlärningen stannar i molnet och Pi:n får sina parametrar därifrån.
