# Pi-styrd kyla via reläbrygga

Flytta kylaktueringen från RAPT-controllernas temperaturmål till direkta reläer på Raspberry Pi:n (samma Pi som BLE-scannar). Värmen ligger kvar på RAPT som idag. PID-hjärnan ligger kvar i molnet — Pi:n blir en dum men snabb och pålitlig aktuator.

## Varför detta löser dagens problem

Dagens kyla styrs genom att skriva ett extremt måltemp (-5°) till RAPT och sedan reverta. Det ger de fel vi jagat i veckor: burst-upplösning på ~30 s i bästa fall, tappade revert-kommandon som låser full kyla i 20 min, API-latens, och 15 min sensorfördröjning från Pill/probe. Med reläer och PT100 direkt på Pi:n försvinner hela den kedjan.

## Hårdvara som kopplas in

- 3 cirkulationspumpar — en per tank (Blå, Gul, Grön), ett relä var
- Glykolkylaren på ett fjärde relä (valfritt, kan lämnas manuell i steg 1)
- 4 st PT100 med MAX31865-kort — en per tank plus en i glykoltanken

## Så här fungerar det

```text
Moln (PID var 5:e min)          Pi (lokalt, 1 Hz)
  beräknar duty% + mode   ->   pi_actuation (tabell)
                               Pi pollar var 5:e s
                               kör PWM-fönster själv
                               slår relä on/off
  <-  PT100 var 10:e s     <-  temperaturer + relästatus
```

- Molnet skickar bara `duty_pct`, `mode` och `pwm_period_s` per tank — ingen tidsstyrning utom periodlängden.
- Pi:n äger PWM-fönstret lokalt (1 s upplösning). Perioden är konfigurerbar per tank i `pi_actuation.pwm_period_s`, default **180 s (3 min)**.
- Minsta på-tid 5 s: pumpen behöver några sekunder innan den byggt tryck i kylledningen, så kortare pulser ger nästan ingen verklig kyla. En begärd duty som motsvarar mindre än 5 s körs inte som en stympad puls utan skjuts upp och ackumuleras till nästa fönster — t.ex. 1 % på 3 min (1.8 s) blir en 5-sekunders puls var 3:e fönster i stället för en verkningslös kortpuls.
- Minsta av-tid 5 s: pumpen får inte kortcykla av/på snabbare än så. En duty som skulle kräva ett av-brott kortare än 5 s förlängs till 5 s och överskottet dras från nästa fönster.
- Effektiv upplösning vid 3 min-period blir ~2.8 %, men med ackumuleringen kan godtyckligt låg duty levereras korrekt över tid — mot dagens 2 % golv där korta bursts dessutom levererades opålitligt.
- Failsafe: tappar Pi:n kontakt med molnet kör den vidare på senaste duty i 30 min, därefter stänger den av alla pumpar. Watchdog i molnet larmar om Pi:n inte hörts på 2 min.
- Glykolreläet styrs av en enkel hysteres på glykol-PT100 (t.ex. på under 7°, av på 4°) — inte av PID.

## Etapper

**Etapp 1 — kyla via relä, PT100 som extra sensor**
- Ny tabell `pi_actuation`: per controller `duty_pct`, `mode`, `updated_at`, `expires_at`.
- Ny edge-funktion `pi-control` (GET): Pi hämtar aktuella duty-värden, autentiseras med samma `PI_BLE_INGEST_SECRET`-mönster som BLE-ingesten.
- Ny edge-funktion `pi-telemetry` (POST): Pi rapporterar PT100-temperaturer, reläläge, faktisk levererad on-tid per fönster.
- Ny tabell `pi_probe_readings` för PT100-data, samt `pi_relay_state`.
- Ny kolumn på `rapt_temp_controllers`: `cool_actuation` = `rapt` (dagens) eller `pi`. Alla tre aktiva sätts till `pi` efter test.
- `auto-adjust-cooling` skriver duty till `pi_actuation` i stället för att manipulera RAPT-mål när `cool_actuation = 'pi'`. Ingen PID-matematik ändras.
- `execute-pwm-off`, mid-burst-glykolvakten och orphan-vakten hoppar över Pi-styrda tankar — de behövs inte längre där.
- Värme: oförändrat, RAPT sköter det via nuvarande väg.

**Etapp 2 — PT100 som SSOT**
- När PT100-data validerats mot Pill/probe i några dygn byts `actual_temp` till PT100 för de tankar som har en. Det tar bort ~15 min sensorlatens, vilket i sin tur låter oss halvera dödtidskonstanten och skärpa D-bromsen.
- Läropparametrar (`dead_time_hours`, `process_gain`) nollställs vid bytet eftersom de är inlärda på en långsammare sensor.

**Etapp 3 — rensning**
- När Pi-kylan gått stabilt kan PWM-hacket mot RAPT tas bort helt för kyla.

## UI

- Relästatus per tank i controller-kortet (liten pump-ikon som lyser vid on-fas).
- PT100-temperatur visas bredvid Pill/probe i sensorraden.
- Växel i inställningar per controller: kyla via RAPT eller Pi.

## Vad du behöver göra på Pi:n

Pi-koden ligger utanför det här projektet. Jag levererar ett färdigt Python-skript (relästyrning + MAX31865-avläsning + poll/rapport-loop + failsafe) som du kör som en systemd-tjänst bredvid BLE-scannern, plus GPIO-pinnkarta. Behöver veta vilken relämodul (aktiv hög/låg) och vilka GPIO-pinnar som är lediga.

## Teknisk detalj

- Autentisering: `x-pi-secret` mot befintlig `PI_BLE_INGEST_SECRET`, service-role-klient i edge-funktionen, samma mönster som `ingest-pill-ble`.
- RLS: `pi_actuation`, `pi_probe_readings`, `pi_relay_state` läsbara för `authenticated` (UI), skrivbara endast via `service_role`.
- Pi:n skriver aldrig direkt mot databasen — allt går genom de två edge-funktionerna.
- `pi_actuation.expires_at` sätts till `now() + 30 min` av molnet; Pi:n använder den som sin egen failsafe-klocka så att regeln är samma på båda sidor.
- Pi:n håller en `duty_debt`-räknare per tank (kvarvarande sekunder som inte kunde levereras p.g.a. 5-sekundersgolvet) och rapporterar faktiskt levererad on-tid per fönster via `pi-telemetry`, så molnets inlärning ser verklig kyla i stället för begärd.
