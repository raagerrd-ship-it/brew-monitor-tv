
## v12 — Verifierat BLE-utskriftsprotokoll för Phomemo M110 (Q199)

### Verifierat protokoll (2026-02-27)

Testat och bekräftat via `/printer-debug` med fysisk skrivare.

**Sekvens:**
1. `ESC @` (0x1b 0x40) — Initialize
2. `Start-job` (0x1f 0x11 0x02 0x00)
3. `GAP-mode` (0x1f 0x11 0x0e 0x01)
4. `Speed` (0x1b 0x4e 0x0d 0x03)
5. `Density` (0x1b 0x4e 0x04 0x08)
6. Margin-reset: GS L (0x1d 0x4c 0x00 0x00), ESC $ (0x1b 0x24 0x00 0x00), ESC B (0x1b 0x42 0x00)
7. **Single raster block**: GS v 0 (0x1d 0x76 0x30 0x00) + width_bytes(LE) + height(LE) — height = exakt antal rader
8. Bilddata i **100-byte chunks** med `auto` writeMethod (skrivarens default)
9. Wait 3s (drain — låt skrivaren mata ut)
10. `End-job` (0x1f 0x11 0x03 0x00)

### Viktiga insikter
- **Chunk-storlek: 100B max** — 200B+ orsakar korrupt data (prickmönster). 20B fungerar men tar ~60s. 100B är sweet spot.
- **Single block** — Multi-block (256 rader per block) med separata GS v 0 headers orsakade korrupt utskrift. Använd alltid ett enda block.
- **Auto writeMethod** — Skrivarens default writeMethod fungerar. `forceNoResponse` orsakar "Waiting for data". `forceWithResponse` fungerar men är onödigt om auto redan ger `withResponse`.
- **0x0a-escaping** — Alla 0x0a (LF) bytes i bilddatan ersätts med 0x14.
- **Högermarginalkompensation** — 16px mjukvarumarginal på höger sida kompenserar skrivarens fysiska offset.
- **Etikettstorlek** — 50×70mm @ 203dpi = 384×555px (48 widthBytes, 555 height inkl lead-in/trail)
- **Notify-kanal** — Karakteristik 0xff03 ger transport-ACK (0x01 0x01), inte "utskrift klar"-status.
- **Ingen print-execute** — 0x04 orsakar hängningar. Skrivaren matar ut automatiskt efter komplett rasterdata.

### Debug-verktyg
`/printer-debug` har chunk-väljare (20/50/100/200/500B) och ACK-loggning för framtida felsökning.
