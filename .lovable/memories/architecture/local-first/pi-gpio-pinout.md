---
name: Pi GPIO-pinout (hårdvaruspec)
description: Fast GPIO/BCM-tilldelning för PT100 (MAX31865) och 7 reläer på Pi 5, återanvänd från Smart Brew Controller
type: feature
---
BCM-numrering. SPI delas: MOSI 10, MISO 9, SCK 11.

CS PT100: glykol 5, tank1 6, tank2 13, tank3 19.
Reläer: tank1 heat/cool 17/27, tank2 22/23, tank3 24/25, kompressor 26.
Reserv ventiler: CO2 12, tryckavlastning 16.

- `active_high: false` (aktivt-LÅG reläkort), alla utgångar initieras OFF.
- Dwell (min_on 60 s / min_off 300 s) endast på kompressorn; tankreläer skyddas av snap <10 % ⇒ AV, >91 % ⇒ PÅ.
- Pi 5 kräver `GPIOZERO_PIN_FACTORY=lgpio`; användaren i grupperna `gpio` och `spi`.
- PCIe-2.5G-kort tar inga GPIO.
