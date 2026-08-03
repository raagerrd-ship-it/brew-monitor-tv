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
  -> target_temp per tank    ->     pi_setpoint (hämtas var 30:e s)
  ff/Kp/Kd/dödtid (långsamt) ->     PID-beslut var 180:e s mot PT100
                                    trimI ägs lokalt av Pi:n
                                    lägesval kyla/värme
                                    PWM-fönster + reläer
  historik, inlärning, UI    <-     snabbsynk 30 s / full synk 5 min
                             <->    lokalt webb-UI på Pi:n (utan internet)
```

**Molnet äger:** profilsteg och rampning, målvärde, *långsamt* lärda parametrar (ff, Kp, Kd, dödtid), all loggning/graf/notiser, UI.

**Pi:n äger:** **hela sensorbilden inklusive `actual_temp` (SSOT)**, PID mot målet, *den snabba integratorn* (`trimI`), lägesval kyla/värme, PWM-fönster, reläer, **glykolkylarens börvärde**, all säkerhet i realtid.

Den uppdelningen är viktig: molnet får inte också integrera bort samma fel som Pi:n redan integrerar bort — då får vi två integratorer som jagar varandra och exakt den windup vi just byggt bort. Molnet lär bara långsamt (timmar/dygn) på levererad on-tid, Pi:n reglerar snabbt (minuter).

**Pill/SG:** kommer från BLE-sniffern som redan kör på samma Pi (`pi/brew-ble` → `ingest-pill-ble`), inte från RAPT Cloud. SG och pill-temp går alltså lokalt hela vägen.

## Pi:n bygger SSOT, inte molnet

Idag konstrueras `actual_temp` i molnet (`dual-sensor.ts` / `controller-adjustments.ts`) av pill och probe, och skickas sedan till PID:n. Det är fel plats när både sensorerna och regulatorn sitter på Pi:n — molnet blandar sensorer som är upp till 15 minuter gamla och skickar resultatet tillbaka till en loop som hade färsk data hela tiden.

Därför flyttas SSOT-bygget till Pi:n:

- Alla råkällor finns redan lokalt: PT100 (1 Hz, kabel), Pill via BLE-sniffern (samma Pi), och RAPT-probe så länge den finns kvar.
- Pi:n gör dubbelgivarlogiken: val av preferred sensor, pill/probe-offset och dess baseline, färskhetskontroll per källa, drift-detektering med streak-räknare, och fallback när en källa tystnar. Samma regler som `dual-sensor.ts` — porterade, inte omtänkta.
- Resultatet `actual_temp` matas rakt in i PID:n på Pi:n och rapporteras upp i telemetrin tillsammans med *vilken* källa som användes och varför.
- Molnet slutar räkna fram `actual_temp` för Pi-tankar och blir konsument: grafer, inlärning, notiser. Kolumnen finns kvar och fylls av Pi:n.
- Vinsten är inte bara latens: driftvarningarna vi fick i somras kom av att molnet jämförde två källor med olika ålder. Med båda avlästa lokalt på samma sekund blir jämförelsen faktiskt giltig.
- Grundregeln från idag gäller fortfarande: **PID:n läser bara SSOT**, aldrig råa pill- eller probe-värden. Sensorblandningen sker uppströms, i SSOT-bygget.

**RAPT Cloud:** bara reservväg tills Pi-vägen är bevisad. När kyla, värme, tanktemp (PT100) och SG (BLE) alla går via Pi:n finns inget kvar som kräver RAPT:s moln-API i löpande drift.

## Så här fungerar Pi-loopen

- Läser PT100 var 1:a sekund, filtrerar lätt (2–3 min EMA räcker när sensorn sitter direkt på tanken).
- **Men reglerbeslutet tas inte varje sekund** — det tas en gång per PWM-fönster (180 s). Processen har tiotals minuters dödtid; att räkna om duty varje sekund tillför ingen styrning, bara brusförstärkning i D-termen och en duty som ändras mitt i ett pågående fönster. Snabb mätning + långsamt beslut är rätt kombination. 1 Hz-datan används till D-termen (linjär regression över 60 s i stället för en differens mellan två sampel) och till säkerhetsvakterna, som *får* agera direkt.
- PID: `duty = ff + trimI + Kp·fel − Kd·temphastighet`. Samma formel som molnets V6 — porteras rakt av till Python, inte omskriven.
- Lägesval kyla/värme med samma tvåstegs-hysteres som idag (neutralband, tidsvillkorad flip, direkt flip vid stort fel) plus 1-timmarslatchen — men nu lokalt på färsk sensordata i stället för på 5-minuterscykel.
- Kyl- och värmerelä kan aldrig vara på samtidigt (hårt interlock), och det krävs en minsta paus vid lägesbyte.
- ΔT-kompensation lokalt: on-tiden skalas mot aktuell glykoltemperatur, så samma kyleffekt levereras vare sig glykolen står på 8° eller 2°. Detta ersätter både ΔT-normaliseringen och mid-burst-glykolvakten i molnet. Med behovsstyrd glykol (nedan) blir ΔT dessutom nästan konstant, så kompensationen går från huvudmekanism till liten korrigering.
- PWM-fönster default **180 s (3 min)**, konfigurerbart per tank och per läge.
- **Minsta på-tid 5 s och minsta av-tid 5 s — gäller både kyla och värme.** För kylan behöver pumpen bygga tryck i ledningen; för värmen undviker vi kortcykling av reläet och elementet. Samma regel, samma kod, båda lägena.
- Kortare begärd on-tid än 5 s körs inte som en stympad puls utan ackumuleras i en `duty_debt`-räknare (en per läge) och levereras som en 5-sekunderspuls när skulden räcker till. Ett av-brott kortare än 5 s förlängs till 5 s och överskottet dras från nästa fönster.
- Båda tiderna är konfigurerbara per tank och per läge (`min_on_s` / `min_off_s`) om det visar sig att värmen tål eller behöver andra värden.
- **Samordning mellan tankar:** Pi:n ser alla tre tankarna, så on-faserna fasförskjuts i stället för att råka sammanfalla. Två pumpar samtidigt sänker glykoltemperaturen dubbelt så fort och gör ΔT-kompensationen till en jakt. Med lokal samordning blir lasten jämn — något molnet aldrig kunnat göra, eftersom varje tank räknades för sig.

## Behovsstyrd glykolkylare

Glykolen ska inte köras som en dum termostat på ett fast börvärde. Pi:n ser alla tankars behov samtidigt och sätter glykoltemperaturen därefter — det är den enskilt största förbättringen utöver att flytta loopen.

**Så här sätts börvärdet**

- Utgå från kallaste tankmålet: `glykol_bör = min(tankmål) − arbetsmarginal`. Marginalen väljs efter faktiskt behov, inte efter värsta tänkbara fall.
- **Inget behov → låt den gå varm.** Ligger alla tankar i sitt neutralband och ingen kyler, höjs börvärdet till ett viloläge (t.ex. **15°**). Kylaren står då still i timmar i stället för att hålla 4° i onödan.
- **Litet behov (hålldrift, några procents duty)** → måttlig marginal, t.ex. 4–5° under kallaste målet. Det räcker gott för att parera 0,3 °C/h passiv drift.
- **Stort behov (kallcrash, aktiv rampning ner, hög jäsningsvärme)** → full marginal ner mot minvärdet. Här *vill* vi ha kyleffekt.
- Börvärdet ändras med rampbegränsning (t.ex. max några grader per 10 min) så tanksidan aldrig ser ett språng i kyleffekt mitt i en burst — det var precis det som brände Gul i morse.
- Hysteres runt börvärdet som förut, plus minsta gångtid och minsta stopptid på kompressorn så den inte kortcyklar.
- Föraviserat behov: vet Pi:n att en kallcrash är beställd, sänks glykolen *innan* tanken börjar ropa, i stället för att tanken får vänta på en varm kylare.

**Varför det här är rätt**

- ΔT mellan tank och glykol blir stabil i stället för att variera 9° över ett dygn. Då blir en given on-tid faktiskt en given mängd kyla — hela grunden till att PID:n går att lita på.
- Kylaren jobbar mot ett varmare medium när den ändå jobbar → bättre verkningsgrad, mindre el, längre kompressorliv.
- Riskerna vi bevakar: en varm glykol ger långsammare respons om behovet plötsligt kommer. Det hanteras av föraviseringen ovan, av att marginalen aldrig går under ett golv när någon tank är i aktiv jäsning, och av att viloläget bara gäller när *alla* tankar är i neutralband.

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



## Lokalt UI på Pi:n

När hela regleringen ändå kör lokalt är det bara rimligt att också kunna styra den lokalt. Pi:n serverar en liten webbsida på LAN:et (t.ex. `http://brewpi.local`) som fungerar oavsett om internet finns — den pratar bara med Pi:ns egen loop, aldrig via molnet.

**Vad man kan göra**
- **Sätta måltemp per tank** — stora +/− knappar i 0,1°-steg, touch-vänligt, en kolumn per tank.
- **Se status och larm** — tanktemp, måltemp, aktuellt läge, duty, relä på/av, glykoltemp, samt när molnet senast svarade. Lokala larm (sensorfel, gränsvärde, interlock) syns här även när inga push-notiser kan skickas.

Ingen nödstoppsknapp och inget manuellt lägesval i första versionen — säkerhetsavstängning sker automatiskt i loopen, och att tvinga läge förbi PID:n är precis den sortens ingrepp som skapat problem tidigare. Kan läggas till senare.

**Konfliktlösning via tidsstämpel**

Tidsstämpel är rätt lösning här, och den gör att vi slipper hela "vem vinner"-frågan. Varje målvärdesändring bär `set_at` (tidpunkt) och `set_by` (`profile`, `cloud_manual` eller `local_ui`):

- Pi:n behåller alltid den **senaste** ändringen, oavsett varifrån den kom. Sätter du 18,5° lokalt kl 10:00 och profilen rampar till 19,0° kl 11:00, vinner profilen — den är nyare.
- Din lokala ändring skickas upp vid nästa lyckade synk och skriver molnets målvärde med samma tidsstämpel. Molnets UI visar "satt lokalt på Pi:n 10:00" i stället för att tyst skriva över.
- Skulle profilen ha ändrat målet *medan* internet låg nere tar den över när kontakten återkommer — men bara om dess tidsstämpel är nyare än din lokala ändring.

Klockan måste därmed vara pålitlig: Pi:n kör NTP och behöver RTC-modul (eller monoton fallback), så att en klockförskjutning under strömavbrott inte kan få en gammal ändring att se ny ut.

**Teknik**
- Liten FastAPI-app i samma process som reglerloopen (eller egen process mot samma SQLite), serverad över LAN. Ingen molnberoende, inget Supabase-inloggningsflöde — enkel PIN eller enbart LAN-åtkomst.
- Samma sida fungerar både som 7-tums kioskvy (1024x600) på Pi:n och i mobilen på nätverket.

## Säkerhet

- **Internetbortfall stänger inte av något.** Pi:n har sensor, regulator och aktuator lokalt, så den fortsätter hålla senaste målet hur länge som helst. Att slå av allt mitt i en jäsning vore farligare än att hålla ett något gammalt målvärde — en tank som driftar fritt förstör batchen, ett fruset målvärde gör det inte.
- Målvärdet sparas persistent på disk så det överlever en omstart av Pi:n under avbrottet.
- `expires_at` blir därför bara en informationsflagga: Pi:n loggar och rapporterar "setpoint stale" (och visar det i UI:t när kontakten är tillbaka), men fortsätter reglera. Vill du kunna tvinga fram avstängning finns molnets `max_duty_pct = 0` — men den kräver ju kontakt, så den är inte en failsafe utan ett manuellt stopp.
- Det som *ska* stänga av är lokala fel, inte molnfel: sensorbortfall, temperatur utanför hårda gränser, eller relä som stått på för länge. Se punkterna nedan.
- Enda undantaget värt att bevaka: en profil som skulle ha rampat vidare står stilla under avbrottet. Vi larmar när kontakten återkommer och molnet räknar då om steget mot faktisk tid, i stället för att hoppa i temperatur.
- Hårda gränser lokalt: min/max tillåten tanktemp, max sammanhängande on-tid per relä, max duty. Överskrids något bryts reläet oavsett vad PID säger.
- Värmen har en egen övertemperaturspärr (hårt tak) och kräver färsk sensordata — ingen PT100-avläsning på 60 s betyder värme av.
- Sensorbortfall: ingen giltig PT100-avläsning på 60 s → SSOT-bygget faller tillbaka på pill (BLE) om den är färsk, annars bryts båda reläerna. Blir vi helt utan giltig källa reglerar vi blint, och då är avstängning rätt svar.
- Glykolgivarens bortfall: utan giltig glykoltemp går ΔT-kompensationen till sitt mest försiktiga antagande (kallast tänkbara glykol → kortast on-tid) i stället för att gissa.
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
- **Ärv inte dagens lärda värden rakt av.** Nuvarande `dead_time_hours` (Blå 0,72 h), `process_gain` och `ff_duty` är inlärda på en sensor med ~15 min latens och på RAPT:s trubbiga aktuering. Med PT100 direkt på tanken försvinner en stor del av den dödtiden, och för aggressiv Kp blir följden. Vi startar därför konservativt: behåll dagens dödtid som startvärde (för hög dödtid ger *lugn* reglering, inte översläng), sätt `ff` från uppmätt hålleffekt de första dygnen och låt molnet lära om därifrån. Nollställningen som stod i etapp 4 flyttas hit — den hör hemma när PID:n byter sensorbild, inte senare.
- Värmen går fortfarande via RAPT här, så vi byter en sak i taget.

**Etapp 2b — glykolkylaren behovsstyrd**
- Pi:n tar över glykolens börvärde enligt avsnittet ovan (viloläge 15°, marginal efter behov, rampbegränsat).
- Så länge kylaren sitter på RAPT sätts börvärdet via RAPT-mål; när den flyttas till Pi-relä sköts det med lokal hysteres i stället. Logiken för *vilket* börvärde som ska gälla är densamma i båda fallen.
- Görs efter att minst en tank kyls via relä, så vi kan mäta ΔT-stabiliteten före och efter.

**Etapp 3 — värme på Pi**
- Värmeelementen flyttas till Pi-reläerna och Pi:n tar över lägesvalet helt.
- RAPT-controllerns egen termostat neutraliseras (mål långt utanför arbetsområdet) så den aldrig kan slå till parallellt.

**Etapp 4 — SSOT flyttas till Pi och molnkoden rensas**
- SSOT-bygget (dubbelgivare, offset, färskhet, driftdetektering) flyttas från `dual-sensor.ts` till Pi:n, med PT100 som primärkälla. Molnet slutar räkna fram `actual_temp` för Pi-tankar. Omlärningen av dödtid/gain skedde redan i etapp 2.
- **Molnets V6-PID slutar räkna för Pi-tankar helt** — den får inte ligga och producera duty parallellt "för säkerhets skull". Två regulatorer på samma tank är den enda verkliga risken i hela det här bygget. V6 blir kvar orörd, men bara för `actuation = 'rapt'`.
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
