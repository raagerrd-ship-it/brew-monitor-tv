

## Plan: Direktutskrift till Phomemo M110 via Web Bluetooth

### Bakgrund & Analys

Det finns ett aktivt open source-projekt, **Phomymo** (github.com/transcriptionstream/phomymo), som framgångsrikt skriver ut till Phomemo M110 via Web Bluetooth i Chrome. Deras kod visar att:

1. M110 **stödjer BLE** (Bluetooth Low Energy) -- inte bara Classic Bluetooth
2. Vår tidigare implementation misslyckades pga **felaktiga BLE-UUIDer** och saknade M110-specifika protokollkommandon

**Nyckelfynd från Phomymo-projektet:**
- BLE Service UUID: `0xff00` (16-bit, inte de långa 128-bit UUIDer vi använde)
- Write Characteristic: `0xff02`
- Notify Characteristic: `0xff03`
- M110 kräver specifika init-kommandon: Speed (`ESC N 0x0D`), Density (`ESC N 0x04`), Media Type (`1F 11 10`), och en Footer-sekvens (`1F F0 05 00 1F F0 03 00`)
- Chunk size: 128 bytes med 20ms delay
- Fallback-service-UUIDer: `0xffe0`, `0xae30`, `49535343-fe7d-4ae5-8fa9-9fafd205e455`, `0000ff00-0000-1000-8000-00805f9b34fb`

### Ändringar

**1. Skriv om `src/lib/thermal-printer.ts`**

Baserat på den bevisade Phomymo-implementationen:

- **BLE-konstanter**: Uppdatera service UUIDs till `[0xff00, 0xffe0, 0xae30, '49535343-fe7d-4ae5-8fa9-9fafd205e455', '0000ff00-0000-1000-8000-00805f9b34fb']`
- **Write characteristic**: `0xff02`
- **Notify characteristic**: `0xff03` (lägg till stöd för notifications/svar)
- **Chunk size**: 128 bytes, 20ms delay
- **connectPrinter()**: Uppdatera med:
  - Bredare namnfilter: `M`, `D`, `P`, `Q`, `T`, `A`, `Mr.in`, `Phomemo`
  - Retry med exponential backoff (max 1 retry, 300ms initial delay)
  - `watchAdvertisements()` för att vänta tills enheten är redo
  - Fallback till `writeValue` om `writeValueWithoutResponse` misslyckas
- **printBitmap()**: Ny M110-specifik sekvens:
  1. Sätt hastighet: `[0x1b, 0x4e, 0x0d, 5]`
  2. Sätt densitet: `[0x1b, 0x4e, 0x04, densityValue]` (1-15)
  3. Sätt mediatyp: `[0x1f, 0x11, 10]` (etiketter med gap)
  4. Raster header: `[0x1d, 0x76, 0x30, 0x00, widthBytes, 0x00, heightL, heightH]`
  5. Skicka bitmap-data i 128-byte chunks
  6. Footer: `[0x1f, 0xf0, 0x05, 0x00, 0x1f, 0xf0, 0x03, 0x00]`
- **Behåll**: Floyd-Steinberg dithering (redan korrekt implementerad)

**2. Uppdatera `src/components/PrintLabelDialog.tsx`**

Lägg till en "Skriv ut direkt"-knapp som:
- Visar en Bluetooth-ikon + "Skriv ut via Bluetooth"
- Kontrollerar `isBluetoothSupported()` -- döljer knappen om ej stödd
- Vid klick: ansluter till skrivaren (visar BLE-picker), skriver ut canvas-innehållet
- Visar framsteg under utskrift (progress-bar eller text)
- Sparar anslutningen i state så man kan skriva ut flera etiketter utan att para om
- "Koppla från"-knapp visas när ansluten
- Antal kopior-väljare (1-5)
- Felhantering med toast-meddelanden på svenska

**Layout i dialogen:**

```text
┌─────────────────────────────────┐
│ 🖨️ Skriv ut etikett            │
│                                 │
│ [🧪 Jästank] [🛢️ Fat]          │
│                                 │
│ ┌─────────────────────────────┐ │
│ │     (Canvas preview)        │ │
│ └─────────────────────────────┘ │
│                                 │
│ Kopior: [1] [2] [3]            │
│                                 │
│ [📶 Bluetooth: Ej ansluten]    │
│ [🔵 Skriv ut via Bluetooth  ]  │  ← Ny primär knapp
│                                 │
│ [📄 Spara PDF] [🖨️ Systemprint]│  ← Sekundära
│                                 │
│ Öppna PDF:en i PrintMaster...  │
└─────────────────────────────────┘
```

### Teknisk detalj

M110 har printbredd 48 bytes = 384 pixlar. Våra etiketter är 399px breda (50mm vid 203 DPI). Bilddata behöver skalas ner till 384px bredd innan utskrift, eller centreras med padding. Phomymo-projektet löser detta genom att skala canvas till skrivarens bredd. Vi gör samma sak: skala etikettens canvas till 384px bredd, beräkna ny höjd proportionellt.

### Krav

- Chrome, Edge, eller annan Chromium-baserad webbläsare
- Web Bluetooth API (ej Firefox/Safari)
- HTTPS eller localhost
- Android Chrome stöds, iOS stöds ej

