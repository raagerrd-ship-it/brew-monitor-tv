/**
 * Web Bluetooth communication with Phomemo M110 thermal printer.
 * Based on the proven Phomymo open-source implementation.
 * 
 * Label size: 70x50mm at 203 DPI = 559x399 pixels
 * Printer width: 384 pixels (48 bytes)
 * v3 - correct M110 protocol (GS v 0 raster)
 */

export const PRINTER_VERSION = 'v3-gsv0';

// Phomemo BLE Service UUIDs (from Phomymo project)
const SERVICE_UUIDS = [
  0xff00,
  0xffe0,
  0xae30,
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000ff00-0000-1000-8000-00805f9b34fb',
] as const;

// Write characteristic UUIDs
const WRITE_CHAR_UUIDS = [
  0xff02,
  'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f',
  '49535343-8841-43f4-a8d4-ecbe34729bb3',
];

// Printer constants
const BLE_CHUNK_SIZE = 128;
const BLE_CHUNK_DELAY_MS = 20;
const BLE_WRITE_TIMEOUT_MS = 7000;

const LAST_PRINTER_KEY = 'phomemo-last-device';

export interface PrinterConnection {
  device: any;
  characteristic: any;
  writeMethod: 'withoutResponse' | 'withResponse';
}

/** Check if Web Bluetooth is supported */
export function isBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in (navigator as any);
}

/** Save last connected device name for auto-reconnect */
function saveLastDevice(deviceName: string) {
  try { localStorage.setItem(LAST_PRINTER_KEY, deviceName); } catch { /* ignore */ }
}

/** Get last connected device name */
export function getLastDeviceName(): string | null {
  try { return localStorage.getItem(LAST_PRINTER_KEY); } catch { return null; }
}

/** Connect GATT + find service + characteristic for a given device */
async function connectDevice(device: any): Promise<PrinterConnection> {
  const server = await connectWithRetry(device);

  // Find service
  let service: any = null;
  for (const uuid of SERVICE_UUIDS) {
    try {
      service = await server.getPrimaryService(uuid as any);
      break;
    } catch { /* try next */ }
  }
  if (!service) throw new Error('Kunde inte hitta skrivarens BLE-tjänst.');

  // Find write characteristic
  let characteristic: any = null;
  for (const uuid of WRITE_CHAR_UUIDS) {
    try {
      characteristic = await service.getCharacteristic(uuid as any);
      break;
    } catch { /* try next */ }
  }
  if (!characteristic) throw new Error('Kunde inte hitta skrivarens BLE-karaktäristik.');

  const writeMethod = characteristic.properties.writeWithoutResponse ? 'withoutResponse' : 'withResponse';

  // Remember this device
  if (device.name) saveLastDevice(device.name);

  return { device, characteristic, writeMethod };
}

/**
 * Try to reconnect to the last used printer without showing the picker.
 * Uses navigator.bluetooth.getDevices() (Chrome 85+).
 * Returns null if not possible.
 */
export async function reconnectLastPrinter(): Promise<PrinterConnection | null> {
  if (!isBluetoothSupported()) return null;

  const lastDeviceName = getLastDeviceName();
  if (!lastDeviceName) return null;

  try {
    const bt = navigator as any;
    if (!bt.bluetooth?.getDevices) return null;

    const devices = await bt.bluetooth.getDevices();
    const target = devices.find((d: any) => d.name === lastDeviceName);
    if (!target) return null;

    // watchAdvertisements + connect
    if (target.watchAdvertisements) {
      await target.watchAdvertisements();
      // Wait briefly for advertisement
      await new Promise(r => setTimeout(r, 2000));
    }

    if (!target.gatt) return null;
    return await connectDevice(target);
  } catch (e) {
    console.warn('[Printer] Auto-reconnect failed:', e);
    return null;
  }
}

/** Connect to a Phomemo M110 printer via Web Bluetooth (user picker) */
export async function connectPrinter(): Promise<PrinterConnection> {
  if (!isBluetoothSupported()) {
    throw new Error('Web Bluetooth stöds inte i denna webbläsare. Använd Chrome eller Edge.');
  }

  let device: any;
  try {
    device = await (navigator as any).bluetooth.requestDevice({
      filters: [
        { namePrefix: 'M' }, { namePrefix: 'D' }, { namePrefix: 'P' },
        { namePrefix: 'Q' }, { namePrefix: 'T' }, { namePrefix: 'A' },
        { namePrefix: 'Mr.in' }, { namePrefix: 'Phomemo' },
      ],
      optionalServices: SERVICE_UUIDS as any,
    });
  } catch {
    device = await (navigator as any).bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: SERVICE_UUIDS as any,
    });
  }

  return connectDevice(device);
}

/** Connect to GATT server with retry */
async function connectWithRetry(device: any, retries = 1): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const server = await device.gatt!.connect();
      return server;
    } catch (e) {
      if (attempt < retries) {
        await delay(300 * (attempt + 1));
      } else {
        throw new Error('Kunde inte ansluta till skrivaren. Försök stänga av och slå på den.');
      }
    }
  }
  throw new Error('Anslutning misslyckades.');
}

/** Disconnect from printer */
export function disconnectPrinter(connection: PrinterConnection): void {
  try {
    connection.device.gatt?.disconnect();
  } catch { /* ignore */ }
}

/** Send one BLE chunk with timeout so we can identify hanging steps */
async function writeChunkWithTimeout(
  conn: PrinterConnection,
  chunk: Uint8Array,
  context: string,
): Promise<void> {
  const writePromise = conn.writeMethod === 'withoutResponse'
    ? conn.characteristic.writeValueWithoutResponse(chunk)
    : conn.characteristic.writeValueWithResponse(chunk);

  await Promise.race([
    writePromise,
    delay(BLE_WRITE_TIMEOUT_MS).then(() => {
      throw new Error(`Timeout vid skrivning: ${context}`);
    }),
  ]);
}

/** Send raw bytes in chunks */
async function sendChunked(conn: PrinterConnection, data: Uint8Array, context = 'okänt steg'): Promise<void> {
  const totalChunks = Math.ceil(data.length / BLE_CHUNK_SIZE);
  for (let offset = 0; offset < data.length; offset += BLE_CHUNK_SIZE) {
    const chunk = data.slice(offset, offset + BLE_CHUNK_SIZE);
    const chunkNo = Math.floor(offset / BLE_CHUNK_SIZE) + 1;
    await writeChunkWithTimeout(conn, chunk, `${context} (${chunkNo}/${totalChunks})`);

    if (offset + BLE_CHUNK_SIZE < data.length) {
      await delay(BLE_CHUNK_DELAY_MS);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export interface PrintProgress {
  phase: string;
  percent: number;
}

/**
 * M110-specific commands (from phomemo-tools / Phomymo project)
 */
const M110_CMD = {
  SPEED: (speed: number) => new Uint8Array([0x1b, 0x4e, 0x0d, speed]),
  DENSITY: (density: number) => new Uint8Array([0x1b, 0x4e, 0x04, density]),
  MEDIA_TYPE: (type: number) => new Uint8Array([0x1f, 0x11, type]),
  FOOTER: new Uint8Array([0x1f, 0xf0, 0x05, 0x00, 0x1f, 0xf0, 0x03, 0x00]),
};

/** Standard ESC/POS raster header: GS v 0 */
function rasterHeader(widthBytes: number, heightLines: number): Uint8Array {
  return new Uint8Array([
    0x1d, 0x76, 0x30, 0x00,
    widthBytes & 0xff, (widthBytes >> 8) & 0xff,
    heightLines & 0xff, (heightLines >> 8) & 0xff,
  ]);
}

/**
 * Print canvas to Phomemo M110 using the proven Phomymo/phomemo-tools protocol.
 * Uses standard ESC/POS GS v 0 raster command with M110-specific init/footer.
 * Canvas should already be 384px wide (generated by LabelCanvas).
 */
export async function printBitmap(
  connection: PrinterConnection,
  canvas: HTMLCanvasElement,
  copies: number = 1,
  density: number = 8,
  onProgress?: (p: PrintProgress) => void,
): Promise<void> {
  onProgress?.({ phase: 'Förbereder bild...', percent: 5 });

  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.getImageData(0, 0, width, height);

  // Dither to 1-bit monochrome
  onProgress?.({ phase: 'Dithar bild...', percent: 10 });
  const pixels = ditherToMonochrome(imageData);

  // Convert to bitmap: 1 bit per pixel, MSB first, 1 = black dot
  const bytesPerRow = Math.ceil(width / 8);
  const bitmapRows: Uint8Array[] = [];
  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(bytesPerRow);
    for (let x = 0; x < width; x++) {
      if (pixels[y * width + x] === 0) { // black pixel
        const byteIdx = Math.floor(x / 8);
        const bitIdx = 7 - (x % 8);
        row[byteIdx] |= (1 << bitIdx);
      }
    }
    bitmapRows.push(row);
  }

  // Build flat raster data (no line prefixes – raw bitmap bytes)
  const rasterData = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    rasterData.set(bitmapRows[y], y * bytesPerRow);
  }

  // Map density 1-8 to M110 range (~6-15)
  const m110Density = Math.round(5 + Math.max(1, Math.min(8, density)) * 1.25);

  for (let copy = 0; copy < copies; copy++) {
    const copyLabel = copies > 1 ? ` (${copy + 1}/${copies})` : '';
    const basePercent = 15 + (copy / copies) * 80;

    // 1. Set speed (default 5)
    onProgress?.({ phase: `Initierar skrivare${copyLabel}...`, percent: basePercent });
    await sendChunked(connection, M110_CMD.SPEED(5), 'm110:speed');
    await delay(30);

    // 2. Set density
    await sendChunked(connection, M110_CMD.DENSITY(m110Density), 'm110:density');
    await delay(30);

    // 3. Set media type (10 = labels with gaps)
    await sendChunked(connection, M110_CMD.MEDIA_TYPE(10), 'm110:media');
    await delay(30);

    // 4. Send raster header: GS v 0 (standard ESC/POS)
    onProgress?.({ phase: `Skickar header${copyLabel}...`, percent: basePercent + 5 });
    await sendChunked(connection, rasterHeader(bytesPerRow, height), 'm110:raster-header');

    // 5. Send raw bitmap data in BLE chunks
    onProgress?.({ phase: `Skickar bilddata${copyLabel}...`, percent: basePercent + 10 });
    const totalChunks = Math.ceil(rasterData.length / BLE_CHUNK_SIZE);
    for (let i = 0; i < totalChunks; i++) {
      const chunk = rasterData.slice(i * BLE_CHUNK_SIZE, (i + 1) * BLE_CHUNK_SIZE);
      await writeChunkWithTimeout(connection, chunk, `bilddata (${i + 1}/${totalChunks})`);
      if (i < totalChunks - 1) await delay(BLE_CHUNK_DELAY_MS);

      if (i % 10 === 0) {
        const chunkPercent = basePercent + 10 + (i / totalChunks) * 60 * (1 / copies);
        onProgress?.({ phase: `Skickar bilddata${copyLabel}...`, percent: Math.min(95, chunkPercent) });
      }
    }

    // 6. Send M110 footer to finalize print
    await delay(300);
    onProgress?.({ phase: `Slutför utskrift${copyLabel}...`, percent: basePercent + 75 });
    await sendChunked(connection, M110_CMD.FOOTER, 'm110:footer');
    await delay(500);

    if (copy < copies - 1) await delay(500);
  }

  onProgress?.({ phase: 'Klar!', percent: 100 });
}

export interface PrinterDiagnosticResult {
  ok: boolean;
  failedStep?: string;
  errorMessage?: string;
  logs: string[];
  durationMs: number;
}

/**
 * Runs a compact BLE diagnostic print to identify where printer communication hangs.
 */
export async function runPrinterDiagnostic(
  connection: PrinterConnection,
  onProgress?: (p: PrintProgress) => void,
): Promise<PrinterDiagnosticResult> {
  const startedAt = performance.now();
  const logs: string[] = [];
  let currentStep = '';

  const runStep = async (label: string, percent: number, command: Uint8Array, waitMs = 20) => {
    currentStep = label;
    logs.push(`▶ ${label}`);
    onProgress?.({ phase: `Diagnostik: ${label}`, percent });
    await sendChunked(connection, command, `diagnostik:${label}`);
    if (waitMs > 0) await delay(waitMs);
    logs.push(`✅ ${label}`);
  };

  try {
    await runStep('Speed', 10, M110_CMD.SPEED(5), 30);
    await runStep('Densitet', 25, M110_CMD.DENSITY(11), 30);
    await runStep('Mediatyp (gap)', 40, M110_CMD.MEDIA_TYPE(10), 30);

    // Raster header for a small 48x32 test image
    const bytesPerRow = 48;
    const testRows = 32;
    await runStep('Raster header (GS v 0)', 55, rasterHeader(bytesPerRow, testRows), 20);

    currentStep = 'Skicka testmönster';
    logs.push(`▶ ${currentStep}`);
    onProgress?.({ phase: 'Diagnostik: Skickar testmönster', percent: 75 });

    // Raw bitmap data (no line prefix – just alternating black/white rows)
    const testData = new Uint8Array(testRows * bytesPerRow);
    for (let y = 0; y < testRows; y++) {
      const fillByte = y % 2 === 0 ? 0xff : 0x00;
      for (let x = 0; x < bytesPerRow; x++) {
        testData[y * bytesPerRow + x] = fillByte;
      }
    }

    await sendChunked(connection, testData, 'diagnostik:testmönster');
    await delay(60);
    logs.push(`✅ ${currentStep}`);

    await runStep('Footer (M110)', 92, M110_CMD.FOOTER, 300);
    onProgress?.({ phase: 'Diagnostik klar', percent: 100 });

    return {
      ok: true,
      logs,
      durationMs: Math.round(performance.now() - startedAt),
    };
  } catch (error: any) {
    const errorMessage = error?.message || 'Okänt fel';
    logs.push(`❌ ${currentStep}: ${errorMessage}`);

    return {
      ok: false,
      failedStep: currentStep || 'okänt steg',
      errorMessage,
      logs,
      durationMs: Math.round(performance.now() - startedAt),
    };
  }
}

/**
 * Floyd-Steinberg dithering: converts RGBA image data to array of 0 (black) or 255 (white).
 */
function ditherToMonochrome(imageData: ImageData): Uint8Array {
  const w = imageData.width;
  const h = imageData.height;
  const data = imageData.data;

  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const a = data[i * 4 + 3];
    const alpha = a / 255;
    gray[i] = (0.299 * r + 0.587 * g + 0.114 * b) * alpha + 255 * (1 - alpha);
  }

  const result = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const oldVal = gray[idx];
      const newVal = oldVal < 128 ? 0 : 255;
      result[idx] = newVal;
      const error = oldVal - newVal;

      if (x + 1 < w) gray[idx + 1] += error * 7 / 16;
      if (y + 1 < h) {
        if (x - 1 >= 0) gray[(y + 1) * w + (x - 1)] += error * 3 / 16;
        gray[(y + 1) * w + x] += error * 5 / 16;
        if (x + 1 < w) gray[(y + 1) * w + (x + 1)] += error * 1 / 16;
      }
    }
  }

  return result;
}
