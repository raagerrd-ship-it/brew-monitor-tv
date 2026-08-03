---
name: Pi GPIO-pinout (hårdvaruspec)
description: Fast GPIO/BCM-tilldelning för PT100 (MAX31865) och 7 reläer på Pi 5, återanvänd från Smart Brew Controller
type: feature
---
BCM-numrering. SPI delas: MOSI 10, MISO 9, SCK 11.

CS PT100: glykol 5, tank1 6, tank2 13, tank3 19.

Reläer (VERIFIERAT mot fysisk kabeldragning — kablarna sitter omvänt mot "naturlig" ordning):
kompressor 12 (IN1), tank1 heat/cool 26/25 (IN2/IN3), tank2 24/23 (IN4/IN5),
tank3 22/27 (IN6/IN7), CO2 17 (IN8). Tryckavlastning 16 (reserv).

- `active_high: false` (aktivt-LÅG reläkort), alla utgångar initieras OFF.
- Dwell (min_on 60 s / min_off 300 s) endast på kompressorn; tankreläer skyddas av snap <10 % ⇒ AV, >91 % ⇒ PÅ.
- Pi 5 kräver `GPIOZERO_PIN_FACTORY=lgpio`; användaren i grupperna `gpio` och `spi`.
- PCIe-2.5G-kort tar inga GPIO.
