
# Etikettutskrift fran olkortets meny - M110 Thermoskrivare

## Oversikt
Lagt till en "Skriv ut etikett"-funktion direkt i olkortets statusmeny med tva etikettversioner:

1. **Jastank-etikett** - For att markera jastanken under jasning (olnamn, stil, OG, datum, jastemperatur)
2. **Fat-etikett** - For att markera faten vid tappning (olnamn, stil, ABV, FG, tappningsdatum, batch-nummer)

## Etikettdesign (70x50mm, 203 DPI = 559x399px)

### Jastank-etikett
- Olnamn (stor text)
- Stil
- OG-varde
- Bryggt datum (fran events eller startdatum)
- Jastemperatur (fran profil)
- Etikettbild (om tillganglig, liten i hornet)

### Fat-etikett
- Olnamn (stor text)
- Stil
- ABV %
- OG -> FG
- Tappningsdatum (dagens datum som forval)
- Batch-nummer
- Etikettbild (om tillganglig, liten i hornet)

## Tekniska andringar

### 1. Ny fil: `src/lib/thermal-printer.ts`
Bluetooth-kommunikation med Phomemo M110:
- `connectPrinter()` - Ansluter via Web Bluetooth API med kanda Phomemo BLE service UUID:er
- `printBitmap(canvas)` - Konverterar canvas till 1-bit rasterbild, skickar via ESC/POS GS v 0 kommando
- `disconnect()` - Kopplar fran skrivaren
- Hanterar chunking (100 byte per paket med delay) for stabil BLE-overforing

### 2. Ny fil: `src/components/LabelCanvas.tsx`
Canvas-renderare for etiketterna:
- `renderTankLabel(canvas, brew)` - Ritar jastank-etiketten med olnamn, stil, OG, datum, temp
- `renderKegLabel(canvas, brew)` - Ritar fat-etiketten med olnamn, stil, ABV, OG/FG, datum
- Bada renderar pa 559x399px canvas
- Floyd-Steinberg dithering for svartvitt konvertering
- Laddar etikettbild asynkront om tillganglig

### 3. Ny fil: `src/components/PrintLabelDialog.tsx`
Dialog som oppnas fran menyn:
- Flikval: "Jastank" / "Fat"
- Live forhandsvisning av etiketten i canvas
- "Anslut skrivare" knapp (Web Bluetooth pairing)
- Antal kopior (1-10)
- "Skriv ut" knapp
- Statusindikator (ej ansluten / ansluten / skriver ut / klar)
- Felhantering om Web Bluetooth inte stods (visar meddelande om att anvanda Chrome)

### 4. Uppdatering: `src/components/brew-card/BrewCard.tsx`
Lagg till i statusmenyn (efter "Handelser"):
- Ny menyknapp med Printer-ikon och texten "Skriv ut etikett"
- Oppnar PrintLabelDialog med brew-data
- Importerar `Printer` fran lucide-react

### 5. Uppdatering: `src/components/brew-card/types.ts`
Inga andringar behovs - all brew-data som kravs finns redan i `BrewData`-typen (name, style, abv, originalGravity, finalGravity, events, label_image_url, batchNumber).

## Begransningar
- Web Bluetooth kraever Chromium-baserad webblasare (Chrome, Edge)
- Fungerar inte pa iOS Safari eller Firefox
- Om Bluetooth inte stods visas ett tydligt felmeddelande i dialogen
- M110:s BLE UUID kan variera mellan firmwareversioner - kan behova justeras efter forsta test
