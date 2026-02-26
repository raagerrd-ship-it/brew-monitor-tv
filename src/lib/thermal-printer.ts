/**
 * Web Bluetooth communication with Phomemo M110 thermal printer.
 * Based on the proven Phomymo open-source implementation.
 * 
 * Label size: 70x50mm at 203 DPI = 559x399 pixels
 * Printer width: 384 pixels (48 bytes)
 * v4 - improved BLE reliability + proper auto-reconnect
 */

export const PRINTER_VERSION = 'v7-no-media';

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
const BLE_CHUNK_SIZE = 300;
const BLE_CHUNK_DELAY_MS = 5;           // minimal inter-chunk delay
const BLE_WRITE_TIMEOUT_MS = 7000;
const RECONNECT_TIMEOUT_MS = 6000;      // wait for advertisement

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

  // Prefer writeWithoutResponse for speed (no round-trip wait per chunk)
  const writeMethod: 'withResponse' | 'withoutResponse' =
    characteristic.properties.writeWithoutResponse ? 'withoutResponse' : 'withResponse';

  console.log(`[Printer] Write method: ${writeMethod}, device: ${device.name}`);

  // Remember this device
  saveLastDevice(device);

  return { device, characteristic, writeMethod };
}

/**
 * Try to reconnect to the last used printer without showing the picker.
 * Uses navigator.bluetooth.getDevices() (Chrome 85+) with proper advertisement listening.
 * Returns null if not possible.
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

    // If already connected, just use it
    if (target.gatt?.connected) {
      console.log('[Printer] Device already connected');
      return await connectDevice(target);
    }

    // Try advertisement wake-up, but do not abort reconnect if none arrives.
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
      // No watchAdvertisements support — try direct connect
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
      // Small delay before GATT connect (helps with timing issues)
      if (attempt > 0) await delay(500 * attempt);
      const server = await device.gatt!.connect();
      // Small delay after connect before service discovery
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
  // Create a clean buffer (important for sliced arrays)
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

/** Send a small command (not chunked) — for init/config commands */
async function sendCommand(conn: PrinterConnection, cmd: Uint8Array, context: string, waitMs = 30): Promise<void> {
  await writeWithTimeout(conn, cmd, context);
  if (waitMs > 0) await delay(waitMs);
}

/** Send raw bytes in chunks with periodic throttling */
async function sendChunked(
  conn: PrinterConnection,
  data: Uint8Array,
  context = 'data',
  onChunkProgress?: (sent: number, total: number) => void,
): Promise<void> {
  const total = data.length;
  for (let offset = 0, chunkNo = 0; offset < total; offset += BLE_CHUNK_SIZE, chunkNo++) {
    const chunk = data.slice(offset, Math.min(offset + BLE_CHUNK_SIZE, total));
    await writeWithTimeout(conn, chunk, `${context} (${chunkNo})`);

    onChunkProgress?.(offset + chunk.length, total);

    // Small inter-chunk delay to keep stream flowing
    if (offset + BLE_CHUNK_SIZE < total) {
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

  // Build flat raster data
  const rasterData = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    rasterData.set(bitmapRows[y], y * bytesPerRow);
  }

  // Map density 1-8 to M110 range (~6-15)
  const m110Density = Math.round(5 + Math.max(1, Math.min(8, density)) * 1.25);

  console.log(`[Printer] Printing ${width}x${height} (${rasterData.length} bytes), density=${m110Density}, copies=${copies}`);

  for (let copy = 0; copy < copies; copy++) {
    const copyLabel = copies > 1 ? ` (${copy + 1}/${copies})` : '';
    const basePercent = 15 + (copy / copies) * 80;

    // 1. Set speed (default 5)
    onProgress?.({ phase: `Initierar${copyLabel}...`, percent: basePercent });
    await sendCommand(connection, M110_CMD.SPEED(5), 'm110:speed');

    // 2. Set density
    await sendCommand(connection, M110_CMD.DENSITY(m110Density), 'm110:density');

    // 3. Do not force media type; use printer's current paper setting (Print Master style)
    // 4. Send raster header: GS v 0
    onProgress?.({ phase: `Skickar header${copyLabel}...`, percent: basePercent + 5 });
    await sendCommand(connection, rasterHeader(bytesPerRow, height), 'm110:raster-header', 20);

    // 5. Send raw bitmap data in BLE chunks with throttling
    onProgress?.({ phase: `Skickar bilddata${copyLabel}...`, percent: basePercent + 10 });
    await sendChunked(connection, rasterData, 'bilddata', (sent, total) => {
      const chunkPercent = basePercent + 10 + (sent / total) * 60 * (1 / copies);
      onProgress?.({ phase: `Skickar bilddata${copyLabel}...`, percent: Math.min(95, chunkPercent) });
    });

    // 6. Send M110 footer to finalize print
    await delay(200);
    onProgress?.({ phase: `Slutför utskrift${copyLabel}...`, percent: basePercent + 75 });
    await sendCommand(connection, M110_CMD.FOOTER, 'm110:footer', 300);

    if (copy < copies - 1) await delay(400);
  }

  onProgress?.({ phase: 'Klar!', percent: 100 });
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