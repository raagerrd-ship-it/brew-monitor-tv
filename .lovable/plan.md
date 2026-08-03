# PT100-kalibrering (2-punkts) för glykol och varje tank

Ger dig möjlighet att kalibrera varje PT100-givare mot en referens (is-bad och varmt vatten), spara korrigeringen i molnet och verifiera att avläsningen stämmer efteråt.

## Så fungerar det

Varje givare (glykol, tank 1–3) får en **2-punktskalibrering**: du mäter vid en låg och en hög referenstemperatur, anger vad referenstermometern visar, och systemet räknar fram förstärkning och offset.

```text
korrigerad = rå * gain + offset
gain   = (ref_hög - ref_låg) / (rå_hög - rå_låg)
offset = ref_låg - rå_låg * gain
```

Med bara en punkt sparad används gain = 1 (ren offsetjustering), så du kan börja enkelt och fylla på andra punkten senare.

## Flöde i UI:t

Ny sektion **Sensorkalibrering** under Inställningar → Enheter, en rad per givare:

1. Live rå-temperatur och korrigerad temperatur visas sida vid sida, uppdaterat löpande.
2. "Fånga låg punkt" — du sänker givaren i isbad, väntar tills värdet står still, anger referensvärdet (t.ex. 0,0°) och sparar. Den råa avläsningen fångas automatiskt.
3. "Fånga hög punkt" — samma sak i varmt vatten (t.ex. 40–50°).
4. Resultatet visas som gain/offset plus avvikelsen i varje punkt, och kan nollställas.
5. **Verifiering**: knapp "Verifiera" som jämför korrigerat värde mot ett referensvärde du skriver in och visar avvikelse; historiken över de senaste verifieringarna listas så du ser om en givare driver över tid.

Manuell justering finns kvar: du kan skriva in gain och offset direkt om du hellre vill det.

## Teknisk del

**Databas** — ny tabell `sensor_calibration` (en rad per givare):
- `sensor_key` (unik: `glycol`, `tank1`, `tank2`, `tank3`), `label`
- `low_raw`, `low_ref`, `low_captured_at`
- `high_raw`, `high_ref`, `high_captured_at`
- `gain` (default 1), `offset` (default 0), härledda vid spara
- `updated_at`
- RLS: läs för `authenticated` och `anon` (Pi:n läser via anon-nyckel som övriga Pi-tjänster), skriv endast `authenticated` + `service_role`; GRANT enligt policy.

Ny tabell `sensor_calibration_checks` för verifieringshistorik: `sensor_key`, `raw`, `corrected`, `reference`, `deviation`, `created_at`. Läs för authenticated/anon, insert för authenticated.

**Pi-sidan** (`pi/brew-control/`, samma mönster som `pi/brew-ble`):
- Läser `sensor_calibration` vid start och var 60:e sekund, cachar lokalt i JSON så kalibreringen gäller även offline.
- Applicerar `rå * gain + offset` direkt efter MAX31865-avläsningen, före filter och PID. All reglering och all telemetri använder korrigerat värde; råvärdet rapporteras också så UI:t kan visa båda.

**Frontend**:
- `src/components/SensorCalibration.tsx` + `src/hooks/use-sensor-calibration.ts` (realtime-prenumeration enligt befintligt mönster).
- Renderas i `TabsContent value="devices"` i `src/pages/Settings.tsx`.
- Beräkningen av gain/offset läggs i `src/lib/sensor-calibration.ts` så den är testbar; enhetstest för tvåpunktsformeln och enpunktsfallet.

## Ordning

1. Migration för de två tabellerna → verifiera med en läsfråga.
2. `sensor-calibration.ts` + test → testet passerar.
3. UI-komponent inkopplad i Inställningar → punkterna går att fånga, spara och nollställa.
4. Pi-läsning av kalibreringen dokumenteras och kodas när Pi-tjänsten byggs i Etapp 1 (hårdvaran är inte inkopplad än) — tills dess visar UI:t rådata från befintliga källor.
