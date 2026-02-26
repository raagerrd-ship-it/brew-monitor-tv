/**
 * Web Bluetooth communication with Phomemo M110 thermal printer.
 * Based on the proven phomemo-tools reverse-engineered protocol.
 * 
 * Label size: 70x50mm at 203 DPI = 559x399 pixels
 * Printer width: 384 pixels (48 bytes)
 * v26 - single-stream approach with writeWithoutResponse + correct M110 media type
 */

export const PRINTER_VERSION = 'v26-single-stream';

/** Settings version — bump to auto-reset aggressive user profiles */
export const SETTINGS_VERSION = 3;
const SETTINGS_VERSION_KEY = 'phomemo-settings-version';

/** Configurable print settings for troubleshooting */
export interface PrintSettings {
  mediaType: 'none' | 'gap' | 'continuous' | 'mark';
  landscape: boolean;
  speed: number;        // 1-5
  density: number;      // 1-15 (M110 range)
  chunkSize: number;    // bytes per BLE write
  chunkDelay: number;   // ms between chunks
  throttleEvery: number; // extra pause every N chunks
  throttleDelay: number; // ms for that extra pause
  sendSpeed: boolean;
  sendDensity: boolean;
  sendFooter: boolean;
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  mediaType: 'gap',
  landscape: false,
  speed: 5,
  density: 8,
  chunkSize: 200,
  chunkDelay: 5,
  throttleEvery: 0,
  throttleDelay: 0,
  sendSpeed: true,
  sendDensity: true,
  sendFooter: true,
};

/** Check if saved settings need auto-reset (version migration) */
export function migrateSettingsIfNeeded(): boolean {
  try {
    const savedVersion = Number(localStorage.getItem(SETTINGS_VERSION_KEY) || '0');
    if (savedVersion < SETTINGS_VERSION) {
      localStorage.removeItem('phomemo-print-settings');
      localStorage.setItem(SETTINGS_VERSION_KEY, String(SETTINGS_VERSION));
      console.log(`[Printer] Settings migrated v${savedVersion} → v${SETTINGS_VERSION}, reset to safe defaults`);
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

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
const BLE_WRITE_TIMEOUT_MS = 7000;
const RECONNECT_TIMEOUT_MS = 6000;

const LAST_PRINTER_NAME_KEY = 'phomemo-last-device-name';
const LAST_PRINTER_ID_KEY = 'phomemo-last-device-id';

export interface PrinterConnection {
  device: any;
  characteristic: any;
  writeMethod: 'withoutResponse' | 'withResponse';
}

/** Check if Web Bluetooth is supported */
export function isBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in (navigator as any);
}

/** Save last connected device info for auto-reconnect */
function saveLastDevice(device: any) {
  try {
    if (device?.name) localStorage.setItem(LAST_PRINTER_NAME_KEY, device.name);
    if (device?.id) localStorage.setItem(LAST_PRINTER_ID_KEY, device.id);
  } catch {
    /* ignore */
  }
}

/** Get last connected device name */
export function getLastDeviceName(): string | null {
  try { return localStorage.getItem(LAST_PRINTER_NAME_KEY); } catch { return null; }
}

/** Get last connected device id */
function getLastDeviceId(): string | null {
  try { return localStorage.getItem(LAST_PRINTER_ID_KEY); } catch { return null; }
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

  // CRITICAL: Use writeWithoutResponse for speed — writeWithResponse causes
  // printer timeout on large images due to per-chunk round-trip ACK overhead.
  const writeMethod: 'withResponse' | 'withoutResponse' =
    characteristic.properties.writeWithoutResponse ? 'withoutResponse' : 'withResponse';

  console.log(`[Printer] Write method: ${writeMethod}, device: ${device.name}`);

  // Remember this device
  saveLastDevice(device);

  return { device, characteristic, writeMethod };
}

/**
 * Try to reconnect to the last used printer without showing the picker.
 */
export async function reconnectLastPrinter(): Promise<PrinterConnection | null> {
  if (!isBluetoothSupported()) return null;

  const lastDeviceName = getLastDeviceName();
  const lastDeviceId = getLastDeviceId();
  if (!lastDeviceName && !lastDeviceId) return null;

  try {
    const bt = navigator as any;
    if (!bt.bluetooth?.getDevices) {
      console.log('[Printer] getDevices() not supported');
      return null;
    }

    const devices = await bt.bluetooth.getDevices();
    const target = devices.find(
      (d: any) => (lastDeviceId && d.id === lastDeviceId) || (lastDeviceName && d.name === lastDeviceName),
    );
    if (!target) {
      console.log('[Printer] Last device not in paired list');
      return null;
    }

    if (target.gatt?.connected) {
      console.log('[Printer] Device already connected');
      return await connectDevice(target);
    }

    if (target.watchAdvertisements) {
      console.log('[Printer] Trying watchAdvertisements before reconnect...');

      const received = await new Promise<boolean>((resolve) => {
        let done = false;
        const handler = () => {
          if (done) return;
          done = true;
          clearTimeout(timeout);
          target.removeEventListener('advertisementreceived', handler);
          console.log('[Printer] Advertisement received');
          resolve(true);
        };

        const timeout = setTimeout(() => {
          if (done) return;
          done = true;
          target.removeEventListener('advertisementreceived', handler);
          console.log('[Printer] Advertisement timeout, continuing with direct connect');
          resolve(false);
        }, RECONNECT_TIMEOUT_MS);

        target.addEventListener('advertisementreceived', handler);

        target.watchAdvertisements().catch((e: any) => {
          console.log('[Printer] watchAdvertisements error:', e?.message || e);
        });
      });

      if (received) await delay(120);
    } else {
      console.log('[Printer] watchAdvertisements not supported, trying direct connect...');
      await delay(250);
    }

    if (!target.gatt) return null;
    return await connectDevice(target);
  } catch (e: any) {
    console.warn('[Printer] Auto-reconnect failed:', e.message);
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
async function connectWithRetry(device: any, retries = 2): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) await delay(500 * attempt);
      const server = await device.gatt!.connect();
      await delay(100);
      return server;
    } catch (e) {
      console.warn(`[Printer] GATT connect attempt ${attempt + 1} failed:`, e);
      if (attempt >= retries) {
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

/** Send one BLE write with timeout */
async function writeWithTimeout(
  conn: PrinterConnection,
  data: Uint8Array,
  context: string,
): Promise<void> {
  const buffer = new Uint8Array(data).buffer;

  const writePromise = conn.writeMethod === 'withoutResponse'
    ? conn.characteristic.writeValueWithoutResponse(buffer)
    : conn.characteristic.writeValue(buffer);

  await Promise.race([
    writePromise,
    delay(BLE_WRITE_TIMEOUT_MS).then(() => {
      throw new Error(`Timeout vid skrivning: ${context}`);
    }),
  ]);
}

/**
 * Send a contiguous byte stream in chunks via BLE.
 * Uses fire-and-forget writeWithoutResponse for throughput.
 */
async function sendStream(
  conn: PrinterConnection,
  data: Uint8Array,
  chunkSize: number,
  chunkDelay: number,
  onProgress?: (sent: number, total: number) => void,
): Promise<void> {
  const total = data.length;
  for (let offset = 0; offset < total; offset += chunkSize) {
    const chunk = data.slice(offset, Math.min(offset + chunkSize, total));
    await writeWithTimeout(conn, chunk, `stream@${offset}`);
    onProgress?.(offset + chunk.length, total);
    if (offset + chunkSize < total && chunkDelay > 0) {
      await delay(chunkDelay);
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
 * M110 protocol commands (from phomemo-tools reverse engineering of USB packets):
 * 
 * Header:
 *   0x1b 0x4e 0x0d <speed>    Speed (0x01-0x05)
 *   0x1b 0x4e 0x04 <density>  Density (0x01-0x0f)
 *   0x1f 0x11 <media>         Media type: 0x0a=gap, 0x0b=continuous, 0x26=marks
 * 
 * Raster:
 *   0x1d 0x76 0x30 0x00 <wL> <wH> <hL> <hH>  GS v 0 header
 *   <bitmap data>
 * 
 * Footer:
 *   0x1f 0xf0 0x05 0x00 0x1f 0xf0 0x03 0x00
 */

/**
 * Build the ENTIRE print job as a single byte buffer.
 * This ensures the printer receives a complete, well-formed job
 * without gaps that could cause timeout/Feeding states.
 */
function buildPrintJob(
  rasterData: Uint8Array,
  bytesPerRow: number,
  height: number,
  settings: PrintSettings,
): Uint8Array {
  const parts: Uint8Array[] = [];

  // 1. INIT (ESC @)
  parts.push(new Uint8Array([0x1b, 0x40]));

  // 2. Speed (M110: ESC N 0x0d <speed>)
  if (settings.sendSpeed) {
    parts.push(new Uint8Array([0x1b, 0x4e, 0x0d, Math.max(1, Math.min(5, settings.speed))]));
  }

  // 3. Density (M110: ESC N 0x04 <density>)
  if (settings.sendDensity) {
    parts.push(new Uint8Array([0x1b, 0x4e, 0x04, Math.max(1, Math.min(15, settings.density))]));
  }

  // 4. Media type (M110: 0x1f 0x11 <type>)
  // Correct values from phomemo-tools reverse engineering:
  //   0x0a = Label With Gaps
  //   0x0b = Continuous
  //   0x26 = Label With Marks
  if (settings.mediaType !== 'none') {
    const mediaCode = settings.mediaType === 'gap' ? 0x0a
      : settings.mediaType === 'continuous' ? 0x0b
      : settings.mediaType === 'mark' ? 0x26
      : null;
    if (mediaCode !== null) {
      parts.push(new Uint8Array([0x1f, 0x11, mediaCode]));
    }
  }

  // 5. Raster header: GS v 0
  parts.push(new Uint8Array([
    0x1d, 0x76, 0x30, 0x00,
    bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff,
    height & 0xff, (height >> 8) & 0xff,
  ]));

  // 6. Bitmap data
  parts.push(rasterData);

  // 7. Footer (M110 end-of-job signal)
  if (settings.sendFooter) {
    parts.push(new Uint8Array([0x1f, 0xf0, 0x05, 0x00, 0x1f, 0xf0, 0x03, 0x00]));
  }

  // Concatenate into single buffer
  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const buffer = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) {
    buffer.set(part, offset);
    offset += part.length;
  }

  return buffer;
}

/**
 * Print canvas to Phomemo M110.
 * Builds the ENTIRE job as one contiguous byte stream and sends it
 * via writeWithoutResponse in 200-byte chunks with minimal delay.
 */
export async function printBitmap(
  connection: PrinterConnection,
  canvas: HTMLCanvasElement,
  copies: number = 1,
  settings: PrintSettings = DEFAULT_PRINT_SETTINGS,
  onProgress?: (p: PrintProgress) => void,
): Promise<void> {
  // Normalize width to exact M110 print head width (384 px)
  let workingCanvas = canvas;
  const targetWidth = 384;
  if (canvas.width !== targetWidth) {
    const scaled = document.createElement('canvas');
    const scaledHeight = Math.max(1, Math.round((canvas.height * targetWidth) / canvas.width));
    scaled.width = targetWidth;
    scaled.height = scaledHeight;
    const sctx = scaled.getContext('2d');
    if (!sctx) throw new Error('Kunde inte skala etikettbild för utskrift.');
    sctx.imageSmoothingEnabled = false;
    sctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, scaled.width, scaled.height);
    workingCanvas = scaled;
    console.log(`[Printer] Rescaled canvas ${canvas.width}x${canvas.height} -> ${scaled.width}x${scaled.height}`);
  }

  const width = workingCanvas.width;
  const height = workingCanvas.height;
  const ctx = workingCanvas.getContext('2d')!;
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

  const rasterData = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    rasterData.set(bitmapRows[y], y * bytesPerRow);
  }

  // Build complete print job as single buffer
  const jobBuffer = buildPrintJob(rasterData, bytesPerRow, height, settings);
  console.log(`[Printer] Job buffer: ${jobBuffer.length} bytes (${width}x${height}), copies=${copies}, writeMethod=${connection.writeMethod}`);

  for (let copy = 0; copy < copies; copy++) {
    const copyLabel = copies > 1 ? ` (${copy + 1}/${copies})` : '';

    onProgress?.({ phase: `Skickar${copyLabel}...`, percent: 15 + (copy / copies) * 80 });

    // Send entire job as one chunked stream
    await sendStream(
      connection,
      jobBuffer,
      settings.chunkSize,
      settings.chunkDelay,
      (sent, total) => {
        const pct = 15 + ((copy + sent / total) / copies) * 80;
        onProgress?.({ phase: `Skickar${copyLabel}...`, percent: Math.min(95, pct) });
      },
    );

    // Brief pause between copies
    if (copy < copies - 1) {
      await delay(800);
    }
  }

  onProgress?.({ phase: 'Klar!', percent: 100 });
}

/**
 * Print a visible test page through the exact same printBitmap pipeline.
 */
export async function printTestPage(
  connection: PrinterConnection,
  onProgress?: (p: PrintProgress) => void,
): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 240;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Kunde inte skapa testcanvas.');

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Thick black border
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, 10);
  ctx.fillRect(0, canvas.height - 10, canvas.width, 10);
  ctx.fillRect(0, 0, 10, canvas.height);
  ctx.fillRect(canvas.width - 10, 0, 10, canvas.height);

  // Cross lines
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#000000';
  ctx.beginPath();
  ctx.moveTo(20, 20);
  ctx.lineTo(canvas.width - 20, canvas.height - 20);
  ctx.moveTo(canvas.width - 20, 20);
  ctx.lineTo(20, canvas.height - 20);
  ctx.stroke();

  // Center block
  ctx.fillRect(canvas.width / 2 - 60, canvas.height / 2 - 20, 120, 40);

  console.log(`[Printer] TEST PAGE (via printBitmap): ${canvas.width}x${canvas.height}`);

  await printBitmap(connection, canvas, 1, DEFAULT_PRINT_SETTINGS, onProgress);
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