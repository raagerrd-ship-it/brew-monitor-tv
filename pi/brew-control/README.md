# brew-control — PT100-kalibrering

Kalibreringen ligger helt lokalt på Pi:n. Rådata korrigeras direkt efter
MAX31865-avläsningen; molnet får bara den korrigerade temperaturen.

## Formel

```
korrigerad = rå * gain + offset
gain   = (ref_hög - ref_låg) / (rå_hög - rå_låg)
offset = ref_låg - rå_låg * gain
```

Med bara en punkt sparad blir gain = 1 (ren offsetjustering).

## Filer

| Fil | Innehåll |
|---|---|
| `calibration.json` | Punkter + härledda gain/offset per givare (atomisk skrivning) |
| `calibration_checks.jsonl` | Verifieringshistorik, roteras vid 1 MB |

Sökväg styrs av `BREW_CONTROL_DATA` (default: katalogen bredvid koden).

## Givare (BCM)

SPI delas: MOSI 10, MISO 9, SCK 11. CS: glykol 5, tank1 6, tank2 13, tank3 19.

## Köra

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
GPIOZERO_PIN_FACTORY=lgpio python3 web.py    # http://<pi>:8321/calibration
```

Utan MAX31865-hårdvara startar tjänsten ändå; givarna visar `–` tills korten
är inkopplade.

## Kalibrera

1. Sänk givaren i isbad, vänta tills raden visar "står stilla".
2. **Fånga låg punkt** → ange vad referenstermometern visar (t.ex. `0.0`).
3. Upprepa i varmt vatten (40–50°) med **Fånga hög punkt**.
4. **Verifiera** när du vill kontrollera drift; de fem senaste kontrollerna listas per givare.

Orimliga resultat avvisas: gain måste hamna inom 0,9–1,1, offset inom ±5°, och
punkterna måste ligga minst 5° isär.

## Test

```bash
python3 -m unittest discover -s pi/brew-control
```