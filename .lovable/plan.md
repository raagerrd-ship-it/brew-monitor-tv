
## v11 — Hittat grundorsaken via Phomymo-referensimplementation

### Rootcause
Phomymo-projektet (den mest testade open-source Web Bluetooth-implementationen för Phomemo-skrivare) skickar **`MEDIA_TYPE(0x0a)`** (`[0x1f, 0x11, 0x0a]` = "labels with gaps") till M110 **före** rasterdata.

Vår kod hoppade medvetet över detta kommando för att "inte ändra skrivarens mediaikon". Men utan media-type vet inte M110 vad som ska hända efter att den tagit emot bilddatan — och fastnar i "Feeding".

### Genomförda ändringar (v11-media-type)
1. **Lade till `MEDIA_TYPE` command** — `[0x1f, 0x11, 0x0a]` skickas nu före varje utskrift, exakt som i Phomymo.
2. **`withResponse` tvingat** — alla BLE-skrivningar bekräftas av skrivaren (v10).
3. **Konservativa BLE-parametrar** — chunk=128, delay=20ms, throttle var 8:e (v10).
4. **Footer alltid aktiv** — kan inte stängas av av misstag (v10).
5. **Auto-reset av inställningar** vid versionsbyte (v10).
6. **Checklista för pappersvändning** i UI (v10).
7. Fixade duplicerad `delay(400)` i copy-loop.
