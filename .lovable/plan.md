# PT100-kalibrering (2-punkts) — lokalt på Pi:n

Kalibreringen hör hemma där mätningen sker. Pi:n äger givarna, så den äger också korrigeringen: rådata korrigeras direkt efter MAX31865-avläsningen, före filter, PID och all rapportering. Molnet ser bara färdiga, korrigerade värden och behöver inte veta något om kalibrering.

Fördelen: kalibreringen fungerar även utan internet, den kan aldrig komma i otakt med sensoravläsningen, och ingen molnrunda ligger i den kritiska mätvägen.

## Så räknas det

```text
korrigerad = rå * gain + offset
gain   = (ref_hög - ref_låg) / (rå_hög - rå_låg)
offset = ref_låg - rå_låg * gain
```

Med bara en punkt sparad används gain = 1 (ren offsetjustering), så du kan börja enkelt och fylla på andra punkten senare.

## Var kalibreringen bor

`pi/brew-control/calibration.json`, en post per givare (`glycol`, `tank1`, `tank2`, `tank3`) med låg punkt (rå + referens + tidpunkt), hög punkt, samt härledda `gain`/`offset`. Filen skrivs atomiskt (temp-fil + rename) så en avbruten skrivning aldrig lämnar en trasig kalibrering, och läses in vid start samt när filen ändrats.

## Flöde i det lokala UI:t

Ny sida **Kalibrering** i Pi:ns LAN-webbgränssnitt (samma som redan planeras för lokala börvärden), en rad per givare:

1. Live rå-temperatur och korrigerad temperatur sida vid sida, uppdaterat varje sekund.
2. "Fånga låg punkt" — givaren i isbad, vänta tills värdet står still, ange referensvärdet (t.ex. 0,0°). Rå-avläsningen fångas som ett medel över de senaste 30 sekunderna så en enstaka spik inte förstör punkten.
3. "Fånga hög punkt" — samma sak i varmt vatten (t.ex. 40–50°).
4. Resultatet visas som gain/offset plus avvikelsen i varje punkt, med möjlighet att nollställa eller skriva in gain/offset manuellt.
5. **Verifiering** — knapp där du anger vad referenstermometern visar just nu; Pi:n loggar rå, korrigerad, referens och avvikelse. De senaste kontrollerna listas så du ser om en givare driver över tid.

En stabilitetsindikator ("står stilla" / "rör sig") visas innan du får fånga en punkt, så du inte råkar kalibrera mitt i ett tempsvep.

## Molnets roll

Ingen. Pi:n rapporterar enbart korrigerad temperatur i telemetrin — rådata lämnar aldrig Pi:n och syns bara i det lokala kalibrerings-UI:t. Inga nya tabeller, inga nya policies, inga nya fält i molnet.

## Teknisk del

Allt ligger i Python-projektet `pi/brew-control/` (samma mönster som `pi/brew-ble`):

- `calibration.py` — dataklass per givare, tvåpunktsberäkning, enpunktsfall, atomisk läs/skriv av `calibration.json`, samt `apply(raw)`.
- Sensorlagret applicerar `apply()` direkt efter MAX31865-avläsningen. Inget nedströms lager (filter, PID, telemetri, failsafe) ser rådata — det finns bara innanför sensorlagret och på kalibreringssidan.
- Rimlighetsspärr vid spara: `gain` måste hamna inom 0,9–1,1 och `offset` inom ±5°, annars avvisas punkten med förklaring — en orimlig kalibrering är nästan alltid en felmätning.
- Verifieringsloggen skrivs till `calibration_checks.jsonl`, roterad vid 1 MB.
- Enhetstest för tvåpunktsformeln, enpunktsfallet och rimlighetsspärren.
- Det lokala webb-UI:t får endpoints `GET /api/calibration`, `POST /api/calibration/<sensor>/capture`, `POST /api/calibration/<sensor>/verify`, `POST /api/calibration/<sensor>/reset`.

## Ordning

1. `calibration.py` + tester → testerna passerar.
2. Inkoppling i sensorlagret → korrigerat värde används överallt, rått värde stannar lokalt.
3. Endpoints + kalibreringssidan i det lokala UI:t → punkter går att fånga, verifiera och nollställa.

Arbetet görs som en del av Etapp 1 i Pi-planen, när PT100-givarna är fysiskt inkopplade.
