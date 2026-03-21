# Phomemo M110 BLE Printer Driver

Standalone, framework-agnostic Web Bluetooth driver for Phomemo M110/M120/M220 thermal label printers.

No React, no UI dependencies, no hardcoded locale strings — just BLE + raster protocol.

## Quick Start

```typescript
import {
  connectPrinter,
  printBitmap,
  disconnectPrinter,
  DEFAULT_PRINT_SETTINGS,
} from '@/lib/phomemo-driver';

// 1. Connect (opens browser BLE picker)
const conn = await connectPrinter();

// 2. Print a canvas
await printBitmap(conn, myCanvas, 1, DEFAULT_PRINT_SETTINGS, (p) => {
  console.log(`${p.phase}: ${p.percent}%`);
});

// 3. Disconnect
disconnectPrinter(conn);
```

## API Reference

### Connection

| Function | Description |
|---|---|
| `isBluetoothSupported()` | Returns `true` if Web Bluetooth is available |
| `connectPrinter(storage?)` | Opens BLE picker, connects, returns `PrinterConnection` |
| `reconnectLastPrinter(storage?)` | Silently reconnects to last-used device via `watchAdvertisements` (returns `null` on failure) |
| `disconnectPrinter(conn)` | Disconnects GATT |

### Printing

| Function | Description |
|---|---|
| `printBitmap(conn, canvas, copies?, settings?, onProgress?)` | Full pipeline: scales to 384px, Floyd-Steinberg dithers, sends raster job |
| `printBitmapBypassProcessing(conn, canvas, copies?, settings?, onProgress?)` | Bypass: no scaling/dithering, requires 384px canvas, threshold packing only |
| `sendRasterJob(conn, rasterData, widthBytes, height, settings?, onProgress?)` | Low-level: sends pre-built 1-bit raster data directly |

## Label Dimensions

| Property | Value |
|---|---|
| Print width | 384 px (48 bytes) |
| Label height (70×50 mm) | 555 px |
| Physical label size | 70 × 50 mm |
| Resolution | 203 DPI |
| Content margins | 8 px sides, 10 px top, 25 px bottom |

The driver auto-scales any canvas to 384 px width. Height is determined by the input canvas aspect ratio. For standard 70×50 mm labels at 203 DPI, use a 384×555 px canvas.

### Debug

| Function | Description |
|---|---|
| `printDebugTestPattern(conn, settings?, onProgress?)` | Prints a diagnostic gradient/checkerboard pattern |
| `printTestPage(conn, settings?, onProgress?)` | Prints a full test page with density bands |

### Bitmap Utilities

| Function | Description |
|---|---|
| `ditherToMonochrome(imageData)` | Floyd-Steinberg dithering, returns `Uint8Array` of 0/255 pixels |
| `packDitheredPixels(pixels, w, h)` | Packs dithered pixel array into 1-bit raster format |
| `packThresholdBitmap(canvas)` | Direct threshold (no dithering), returns packed bitmap |

### Storage

| Function | Description |
|---|---|
| `createDeviceStorage(prefix?)` | Creates a namespaced `DeviceStorage` for remembering last device |
| `defaultStorage` | Default instance with `'phomemo'` prefix |
| `migrateSettingsIfNeeded(prefix?, version?)` | Auto-resets saved settings when version bumps |

## Types

```typescript
interface PrinterConnection {
  device: BluetoothDevice;
  characteristic: BluetoothRemoteGATTCharacteristic;
  writeMethod: 'withoutResponse' | 'withResponse';
}

interface PrintProgress {
  phase: ProgressPhase;
  percent: number;
  detail?: string; // e.g. "copy 2/3"
}

type ProgressPhase =
  | 'preparing'
  | 'connecting'
  | 'sending_settings'
  | 'sending_header'
  | 'printing'
  | 'waiting'
  | 'finishing'
  | 'done';

interface PrintSettings {
  mediaType: 'none' | 'gap' | 'continuous' | 'mark';
  landscape: boolean;
  speed: number;          // 1–5
  density: number;        // 1–15
  chunkSize: number;      // bytes per BLE write
  chunkDelay: number;     // ms between chunks
  throttleEvery: number;  // extra pause every N chunks
  throttleDelay: number;  // ms for that extra pause
  sendSpeed: boolean;
  sendDensity: boolean;
  sendFooter: boolean;
}
```

## Progress Handling

The driver reports progress via typed phases — no UI strings baked in. Map them to your own labels:

```typescript
const labels: Record<ProgressPhase, string> = {
  preparing: 'Preparing image…',
  connecting: 'Connecting…',
  sending_settings: 'Configuring printer…',
  sending_header: 'Sending header…',
  printing: 'Printing…',
  waiting: 'Waiting for printer…',
  finishing: 'Finishing…',
  done: 'Done!',
};

await printBitmap(conn, canvas, 1, DEFAULT_PRINT_SETTINGS, (p) => {
  showStatus(labels[p.phase], p.percent);
});
```

## Auto-Reconnect

Silently reconnect to the last-used printer without showing the BLE picker:

```typescript
const conn = await reconnectLastPrinter();
if (conn) {
  console.log(`Reconnected to ${conn.device.name}`);
} else {
  // Fall back to manual picker
  const conn = await connectPrinter();
}
```

## Custom Storage Prefix

Avoid `localStorage` key collisions when using multiple driver instances:

```typescript
const storage = createDeviceStorage('my-app');
const conn = await connectPrinter(storage);
```

## Print Settings

```typescript
// Conservative defaults (works on most M110 units)
const settings = { ...DEFAULT_PRINT_SETTINGS };

// Darker print
settings.density = 12;

// Slower BLE for flaky connections
settings.chunkSize = 60;
settings.chunkDelay = 10;
settings.throttleEvery = 20;
settings.throttleDelay = 200;
```

## Module Structure

```
phomemo-driver/
├── index.ts        — Public re-exports
├── types.ts        — TypeScript interfaces
├── constants.ts    — BLE UUIDs, defaults, version
├── storage.ts      — localStorage device persistence
├── connection.ts   — BLE connect / reconnect / disconnect
├── protocol.ts     — M110 raster job protocol
├── bitmap.ts       — Dithering + bitmap packing
└── debug-pattern.ts — Test pattern generators
```

## Browser Support

Requires [Web Bluetooth API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API) — Chrome/Edge/Opera on desktop and Android. Not supported in Firefox or Safari.
