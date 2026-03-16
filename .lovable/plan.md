

## Plan: Extrahera thermoskrivardrivrutin som fristående modul

### Mål
Paketera all Phomemo M110-logik som en fristående, importerbar drivrutin utan app-specifika beroenden (inga toasts, inga svenska hårdkodade strängar, inget React).

### Nuläge
`src/lib/thermal-printer.ts` är redan nästan fristående — inga app-imports. Men:
- Svenska UI-strängar hårdkodade i progress-callbacks och felmeddelanden
- `localStorage`-nycklar saknar namespace
- Allt i en stor fil (740 rader)
- Ingen tydlig "driver API" vs interna detaljer

### Struktur

```text
src/lib/phomemo-driver/
├── index.ts              # Public API (re-exports)
├── connection.ts         # BLE connect/reconnect/disconnect
├── protocol.ts           # M110 raster protocol (sendRasterJob)
├── bitmap.ts             # Dithering + threshold packing
├── debug-pattern.ts      # Test pattern generation
├── storage.ts            # localStorage device persistence
├── types.ts              # PrinterConnection, PrintSettings, PrintProgress
└── constants.ts          # UUIDs, defaults, version
```

### Ändringar

**1. Ny modul `src/lib/phomemo-driver/`** (7 filer)
- Dela upp `thermal-printer.ts` i logiska delar
- Alla felmeddelanden på engelska (eller med error codes)
- Typade events istället för svenska progress-strängar:
  ```typescript
  type ProgressPhase = 'preparing' | 'connecting' | 'sending_settings' | 'printing' | 'waiting' | 'finishing' | 'done';
  ```
- `storage.ts` tar emot valfri `prefix` för localStorage-nycklar
- Ren export-yta:
  ```typescript
  // Användning i annan app:
  import { connectPrinter, printBitmap, DEFAULT_SETTINGS } from '@/lib/phomemo-driver';
  ```

**2. Uppdatera `src/lib/thermal-printer.ts`**
- Blir en tunn wrapper som re-exporterar från `phomemo-driver/`
- Mappar `ProgressPhase` → svenska strängar för bakåtkompatibilitet
- Inga ändringar behövs i resten av appen

**3. Oförändrade filer**
- `use-printer-connection.ts` — importerar fortfarande från `@/lib/thermal-printer`
- `PrintLabelDialog.tsx`, `PrinterDebug.tsx` — inga ändringar
- `label-utils.ts` — stannar kvar separat (app-specifik PDF/print)

### Tekniska detaljer

**Progress-typning (driver-nivå):**
```typescript
export interface PrintProgress {
  phase: ProgressPhase;
  percent: number;
  detail?: string; // e.g. "copy 2/3"
}
```

**Storage-abstraktion:**
```typescript
export function createDeviceStorage(prefix = 'phomemo') {
  return {
    getLastName: () => localStorage.getItem(`${prefix}-last-device-name`),
    setLast: (device: BluetoothDevice) => { ... },
    clear: () => { ... },
  };
}
```

**Wrapper i thermal-printer.ts (bakåtkompatibilitet):**
```typescript
export { connectPrinter, disconnectPrinter, ... } from './phomemo-driver';

const PHASE_LABELS: Record<ProgressPhase, string> = {
  preparing: 'Förbereder bild...',
  printing: 'Skriver ut...',
  // ...
};
```

### Filer som skapas/ändras
- **Nya**: 8 filer i `src/lib/phomemo-driver/`
- **Ändras**: `src/lib/thermal-printer.ts` (wrapper)
- **Oförändrade**: Alla komponenter och hooks som importerar från `thermal-printer`

