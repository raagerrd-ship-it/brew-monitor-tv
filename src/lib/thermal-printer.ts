/**
 * Web Bluetooth communication with Phomemo M110 thermal printer.
 * Protocol exactly matches phomemo-tools (vivier/phomemo-tools on GitHub),
 * the proven reverse-engineered CUPS driver for M110/M120/M220.
 *
 * Key protocol details from phomemo-filter.py:
 *  - Image sent in blocks of max 256 lines, each with its own GS v 0 header
 *  - 0x0a bytes in bitmap data replaced with 0x14 (printer interprets 0x0a as LF)
 *  - Footer: ESC d 2 × 2, then 0x1f 0x11 × 4 (status commands)
 *  - Header: ESC @ + ESC a 1 + 0x1f 0x11 0x02 0x04
 *
 * v27 - exact phomemo-tools protocol
 */

export const PRINTER_VERSION = 'v41-ack-synced-engine';

/** Settings version — bump to auto-reset aggressive user profiles */
export const SETTINGS_VERSION = 8;
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
  speed: 3,
  density: 8,
  chunkSize: 100,
  chunkDelay: 0,
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

// ── BLE Service & Characteristic UUIDs ──────────────────────────

const SERVICE_UUIDS = [
  '0000ff00-0000-1000-8000-00805f9b34fb',
  0xff00,
  0xffe0,
  0xae30,
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
] as const;

const WRITE_CHAR_UUIDS = [
  '0000ff02-0000-1000-8000-00805f9b34fb',
  0xff02,
  'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f',
  '49535343-8841-43f4-a8d4-ecbe34729bb3',
];

const BLE_WRITE_TIMEOUT_MS = 7000;
const RECONNECT_TIMEOUT_MS = 10000;
const LAST_PRINTER_NAME_KEY = 'phomemo-last-device-name';
const LAST_PRINTER_ID_KEY = 'phomemo-last-device-id';

/** Pre-seed the last device name so auto-reconnect can find it */
export function setTargetPrinterName(name: string): void {
  try { localStorage.setItem(LAST_PRINTER_NAME_KEY, name); } catch { /* ignore */ }
}

/** Remove saved printer so label dialog won't try to reconnect */
export function clearLastDevice(): void {
  try {
    localStorage.removeItem(LAST_PRINTER_NAME_KEY);
    localStorage.removeItem(LAST_PRINTER_ID_KEY);
  } catch { /* ignore */ }
}

// ── Types ───────────────────────────────────────────────────────

export interface PrinterConnection {
  device: BluetoothDevice;
  characteristic: BluetoothRemoteGATTCharacteristic;
  writeMethod: 'withoutResponse' | 'withResponse';
}

export interface PrintProgress {
  phase: string;
  percent: number;
}

// ── Bluetooth helpers ───────────────────────────────────────────

export function isBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

function saveLastDevice(device: BluetoothDevice) {
  try {
    if (device?.name) localStorage.setItem(LAST_PRINTER_NAME_KEY, device.name);
    if (device?.id) localStorage.setItem(LAST_PRINTER_ID_KEY, device.id);
  } catch { /* ignore */ }
}

export function getLastDeviceName(): string | null {
  try { return localStorage.getItem(LAST_PRINTER_NAME_KEY); } catch { return null; }
}

function getLastDeviceId(): string | null {
  try { return localStorage.getItem(LAST_PRINTER_ID_KEY); } catch { return null; }
}

// ── Connection ──────────────────────────────────────────────────

async function connectDevice(device: BluetoothDevice): Promise<PrinterConnection> {
  const server = await connectWithRetry(device);

  let service: BluetoothRemoteGATTService | null = null;
  let matchedServiceUuid: BluetoothServiceUUID | null = null;
  for (const uuid of SERVICE_UUIDS) {
    try { service = await server.getPrimaryService(uuid); matchedServiceUuid = uuid; break; } catch { /* next */ }
  }
  if (!service) throw new Error('Kunde inte hitta skrivarens BLE-tjänst.');
  console.log(`[Printer] Matched service: ${matchedServiceUuid}`);

  let characteristic: BluetoothRemoteGATTCharacteristic | null = null;
  let matchedCharUuid: BluetoothCharacteristicUUID | null = null;
  for (const uuid of WRITE_CHAR_UUIDS) {
    try { characteristic = await service.getCharacteristic(uuid); matchedCharUuid = uuid; break; } catch { /* next */ }
  }
  if (!characteristic) throw new Error('Kunde inte hitta skrivarens BLE-karaktäristik.');

  const writeMethod: 'withResponse' | 'withoutResponse' =
    characteristic.properties.writeWithoutResponse ? 'withoutResponse' : 'withResponse';

  console.log(`[Printer] Connected: ${device.name}, service=${matchedServiceUuid}, char=${matchedCharUuid}, write=${writeMethod}`);
  saveLastDevice(device);
  return { device, characteristic, writeMethod };
}

export async function reconnectLastPrinter(): Promise<PrinterConnection | null> {
  if (!isBluetoothSupported()) return null;
  const lastDeviceName = getLastDeviceName();
  const lastDeviceId = getLastDeviceId();
  if (!lastDeviceName && !lastDeviceId) return null;

  try {
    if (!navigator.bluetooth?.getDevices) return null;

    const devices = await navigator.bluetooth.getDevices();
    const target = devices.find(
      (d) => (lastDeviceId && d.id === lastDeviceId) || (lastDeviceName && d.name === lastDeviceName),
    );
    if (!target) return null;
    if (target.gatt?.connected) return await connectDevice(target);

    if (target.watchAdvertisements) {
      const received = await new Promise<boolean>((resolve) => {
        let done = false;
        const handler = () => { if (done) return; done = true; clearTimeout(t); target.removeEventListener('advertisementreceived', handler); resolve(true); };
        const t = setTimeout(() => { if (done) return; done = true; target.removeEventListener('advertisementreceived', handler); resolve(false); }, RECONNECT_TIMEOUT_MS);
        target.addEventListener('advertisementreceived', handler);
        target.watchAdvertisements().catch(() => {});
      });
      if (received) await delay(120);
    } else {
      await delay(250);
    }

    if (!target.gatt) return null;
    return await connectDevice(target);
  } catch (e: any) {
    console.warn('[Printer] Auto-reconnect failed:', e.message);
    return null;
  }
}

export async function connectPrinter(): Promise<PrinterConnection> {
  if (!isBluetoothSupported()) {
    throw new Error('Web Bluetooth stöds inte i denna webbläsare. Använd Chrome eller Edge.');
  }
  let device: BluetoothDevice;
  try {
    device = await navigator.bluetooth!.requestDevice({
      filters: [
        { namePrefix: 'M' }, { namePrefix: 'D' }, { namePrefix: 'P' },
        { namePrefix: 'Q' }, { namePrefix: 'T' }, { namePrefix: 'A' },
        { namePrefix: 'Mr.in' }, { namePrefix: 'Phomemo' },
      ],
      optionalServices: [...SERVICE_UUIDS],
    });
  } catch {
    device = await navigator.bluetooth!.requestDevice({
      acceptAllDevices: true,
      optionalServices: [...SERVICE_UUIDS],
    });
  }
  return connectDevice(device);
}

async function connectWithRetry(device: BluetoothDevice, retries = 3): Promise<BluetoothRemoteGATTServer> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) await delay(800 * attempt);
      const server = await device.gatt!.connect();
      await delay(100);
      return server;
    } catch (e) {
      console.warn(`[Printer] GATT attempt ${attempt + 1} failed:`, e);
      if (attempt >= retries) throw new Error('Kunde inte ansluta till skrivaren.');
    }
  }
  throw new Error('Anslutning misslyckades.');
}

export function disconnectPrinter(connection: PrinterConnection): void {
  try { connection.device.gatt?.disconnect(); } catch { /* ignore */ }
}

// ── BLE write primitives ────────────────────────────────────────

async function bleWrite(
  conn: PrinterConnection,
  data: Uint8Array,
  ctx: string,
  mode: 'auto' | 'forceNoResponse' | 'forceWithResponse' = 'auto',
): Promise<void> {
  const buffer = new Uint8Array(data).buffer;
  const supportsNoResponse = !!conn.characteristic.properties.writeWithoutResponse;
  const supportsWithResponse = !!conn.characteristic.properties.write;
  const useNoResponse = mode === 'forceNoResponse'
    ? supportsNoResponse
    : (mode === 'forceWithResponse' ? false : (conn.writeMethod === 'withoutResponse' && supportsNoResponse));
  const useWithResponse = mode === 'forceWithResponse' && supportsWithResponse;
  const p = (useNoResponse && !useWithResponse)
    ? conn.characteristic.writeValueWithoutResponse(buffer)
    : conn.characteristic.writeValue(buffer);
  await Promise.race([p, delay(BLE_WRITE_TIMEOUT_MS).then(() => { throw new Error(`BLE timeout: ${ctx}`); })]);
}

/** Send a byte buffer in chunks over BLE */
async function sendChunked(
  conn: PrinterConnection,
  data: Uint8Array,
  chunkSize: number,
  chunkDelay: number,
  throttleEvery: number,
  throttleDelay: number,
  onProgress?: (sent: number, total: number) => void,
): Promise<void> {
  const total = data.length;
  let chunkCount = 0;

  for (let offset = 0; offset < total; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, total);
    await bleWrite(conn, data.slice(offset, end), `chunk@${offset}`);
    onProgress?.(end, total);
    chunkCount++;

    if (end < total && chunkDelay > 0) await delay(chunkDelay);
    if (end < total && throttleEvery > 0 && throttleDelay > 0 && chunkCount % throttleEvery === 0) {
      await delay(throttleDelay);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function toHex(data: Uint8Array): string {
  return Array.from(data).map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

type PrinterNotifyChannel = {
  clear: () => void;
  waitForPacket: (label: string, timeoutMs?: number) => Promise<Uint8Array | null>;
  stop: () => Promise<void>;
};

async function setupNotifyChannel(
  conn: PrinterConnection,
  onLog?: (msg: string) => void,
): Promise<PrinterNotifyChannel | null> {
  try {
    const service = conn.characteristic?.service
      ?? await conn.device.gatt?.getPrimaryService('0000ff00-0000-1000-8000-00805f9b34fb');
    if (!service) return null;

    const notifyChar = await service.getCharacteristic('0000ff03-0000-1000-8000-00805f9b34fb');
    const queue: Uint8Array[] = [];

    const onNotify = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      const value = target?.value;
      if (!value) return;
      const bytes = new Uint8Array(value.buffer.slice(0));
      queue.push(bytes);
      onLog?.(`[Printer][ACK] raw: ${toHex(bytes)}`);
    };

    notifyChar.addEventListener('characteristicvaluechanged', onNotify as EventListener);
    await notifyChar.startNotifications();
    onLog?.('[Printer] Notify-kanal aktiv');

    return {
      clear: () => { queue.length = 0; },
      waitForPacket: async (label: string, timeoutMs = 4000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const pkt = queue.shift();
          if (pkt) {
            onLog?.(`[Printer][ACK] ${label}: ${toHex(pkt)}`);
            return pkt;
          }
          await delay(40);
        }
        onLog?.(`[Printer][ACK] ${label}: timeout efter ${timeoutMs}ms`);
        return null;
      },
      stop: async () => {
        try { notifyChar.removeEventListener('characteristicvaluechanged', onNotify as EventListener); } catch { /* ignore */ }
        try { await notifyChar.stopNotifications(); } catch { /* ignore */ }
      },
    };
  } catch (e: any) {
    onLog?.(`[Printer] Notify-kanal saknas: ${e?.message || 'okänt fel'}`);
    return null;
  }
}

// ── M110 Protocol (from phomemo-tools) ──────────────────────────
//
// phomemo-filter.py header:
//   0x1b 0x40                  ESC @  (initialize)
//   0x1b 0x61 0x01             ESC a  (center justification)
//   0x1f 0x11 0x02 0x04        config (unknown, always sent)
//
// Raster block (max 256 lines per block):
//   0x1d 0x76 0x30 0x00        GS v 0 mode=0
//   <widthBytes> (2 bytes LE)  e.g. 0x30 0x00 = 48
//   <lines - 1>  (2 bytes LE)  height of this block minus 1
//   <bitmap data>              with 0x0a bytes replaced by 0x14
//
// CUPS driver (rastertopm110.py) header:
//   0x1b 0x4e 0x0d <speed>     speed 1-5
//   0x1b 0x4e 0x04 <density>   density 1-15
//   0x1f 0x11 <media_type>     0x0a=gap, 0x0b=continuous, 0x26=marks
//
// CUPS driver raster: same GS v 0, but height = lines (not lines-1)
//   and NO 0x0a escaping (USB transport doesn't have this issue)
//
// phomemo-filter.py footer:
//   0x1b 0x64 0x02             ESC d 2 (print and feed 2 lines)
//   0x1b 0x64 0x02             ESC d 2 (again)
//   0x1f 0x11 0x08             status command
//   0x1f 0x11 0x0e             status command
//   0x1f 0x11 0x07             status command
//   0x1f 0x11 0x09             status command
//
// CUPS driver footer:
//   0x1f 0xf0 0x05 0x00
//   0x1f 0xf0 0x03 0x00
//
// We use the CUPS driver sequence (speed+density+media header, CUPS footer)
// combined with the phomemo-filter.py 0x0a escaping and 256-line blocking.

// M110 CUPS path: single raster block for full image height.

function mediaTypeCode(mt: string): number | null {
  if (mt === 'gap') return 0x0a;
  if (mt === 'continuous') return 0x0b;
  if (mt === 'mark') return 0x26;
  return null;
}

/**
 * Shared raster protocol engine — sends pre-built bitmap data to printer.
 * This is the SINGLE protocol path used by both label printing and debug tests.
 * Timing matches the proven debug flow (300ms between setup commands).
 */
export async function sendRasterJob(
  connection: PrinterConnection,
  rasterData: Uint8Array,
  widthBytes: number,
  height: number,
  settings: PrintSettings = DEFAULT_PRINT_SETTINGS,
  onProgress?: (p: PrintProgress) => void,
  copyLabel: string = '',
): Promise<void> {
  onProgress?.({ phase: `Skickar inställningar${copyLabel}...`, percent: 10 });

  const notify = await setupNotifyChannel(connection, (msg) => console.log(msg));
  try {
    // ── Setup commands with 300ms delays (proven debug timing) ──
    await bleWrite(connection, new Uint8Array([0x1b, 0x40]), 'init');
    await delay(300);

    await bleWrite(connection, new Uint8Array([0x1f, 0x11, 0x02, 0x00]), 'start-job');
    await delay(300);

    const mc = mediaTypeCode(settings.mediaType);
    if (mc !== null) {
      await bleWrite(connection, new Uint8Array([0x1f, 0x11, mc]), 'media-type');
      await delay(300);
    }

    if (settings.sendSpeed) {
      await bleWrite(connection, new Uint8Array([0x1b, 0x4e, 0x0d, Math.max(1, Math.min(5, settings.speed))]), 'speed');
      await delay(300);
    }

    if (settings.sendDensity) {
      await bleWrite(connection, new Uint8Array([0x1b, 0x4e, 0x04, Math.max(1, Math.min(15, settings.density))]), 'density');
      await delay(300);
    }

    // Margin/position reset
    await bleWrite(connection, new Uint8Array([0x1d, 0x4c, 0x00, 0x00]), 'margin-0');
    await delay(50);
    await bleWrite(connection, new Uint8Array([0x1b, 0x24, 0x00, 0x00]), 'abs-pos-0');
    await delay(50);
    await bleWrite(connection, new Uint8Array([0x1b, 0x42, 0x00]), 'esc-b-0');
    await delay(100);

    // Raster header
    onProgress?.({ phase: `Skickar raster-header${copyLabel}...`, percent: 15 });
    await bleWrite(connection, new Uint8Array([
      0x1d, 0x76, 0x30, 0x00,
      widthBytes & 0xff, 0x00,
      height & 0xff, (height >> 8) & 0xff,
    ]), 'raster-header');
    await delay(100);

    // Escape 0x0a → 0x14
    const escapedData = new Uint8Array(rasterData);
    for (let i = 0; i < escapedData.length; i++) {
      if (escapedData[i] === 0x0a) escapedData[i] = 0x14;
    }

    // Send raster data in configurable chunks
    onProgress?.({ phase: `Skriver ut${copyLabel}...`, percent: 20 });
    const CHUNK = Math.max(20, Math.min(500, settings.chunkSize || 100));
    const CHUNK_DELAY = Math.max(0, settings.chunkDelay ?? 0);
    const THROTTLE_EVERY = Math.max(0, settings.throttleEvery ?? 0);
    const THROTTLE_DELAY = Math.max(0, settings.throttleDelay ?? 0);

    await sendChunked(
      connection,
      escapedData,
      CHUNK,
      CHUNK_DELAY,
      THROTTLE_EVERY,
      THROTTLE_DELAY,
      (sent, total) => {
        const pct = 20 + (sent / total) * 70;
        onProgress?.({ phase: `Skriver ut${copyLabel}...`, percent: Math.min(95, pct) });
      },
    );

    // Wait for printer to finish processing raster data
    onProgress?.({ phase: `Väntar på utskrift${copyLabel}...`, percent: 95 });
    await delay(1500);

    // Form feed triggers gap detection — must come after print is done but before paper stops
    await bleWrite(connection, new Uint8Array([0x0c]), 'form-feed');

    // Wait for printer to seek gap and stop
    await delay(2000);

    // End-job + optional ACK wait
    onProgress?.({ phase: `Avslutar${copyLabel}...`, percent: 96 });
    notify?.clear();
    await bleWrite(connection, new Uint8Array([0x1f, 0x11, 0x03, 0x00]), 'end-job');
    await notify?.waitForPacket('ACK efter end-job', 5000);
    await delay(600);
  } finally {
    await notify?.stop();
  }
}

/**
 * Pack canvas to 1-bit bitmap with simple threshold (no dithering).
 */
function packThresholdBitmap(canvas: HTMLCanvasElement): { width: number; height: number; widthBytes: number; bitmapData: Uint8Array } {
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Kunde inte läsa canvas för utskrift.');

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const widthBytes = Math.ceil(width / 8);
  const bitmapData = new Uint8Array(widthBytes * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3] / 255;
      const gray = (0.299 * r + 0.587 * g + 0.114 * b) * a + 255 * (1 - a);
      if (gray < 128) {
        bitmapData[y * widthBytes + Math.floor(x / 8)] |= (1 << (7 - (x % 8)));
      }
    }
  }

  return { width, height, widthBytes, bitmapData };
}

/**
 * Print canvas to Phomemo M110.
 * Full pipeline: optional scale to 384px + dithering + shared raster protocol.
 */
export async function printBitmap(
  connection: PrinterConnection,
  canvas: HTMLCanvasElement,
  copies: number = 1,
  settings: PrintSettings = DEFAULT_PRINT_SETTINGS,
  onProgress?: (p: PrintProgress) => void,
): Promise<void> {
  // ── 1. Normalize to 384px width ──
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
    console.log(`[Printer] Rescaled ${canvas.width}x${canvas.height} → ${scaled.width}x${scaled.height}`);
  }

  const width = workingCanvas.width;
  const height = workingCanvas.height;
  const ctx = workingCanvas.getContext('2d')!;
  const imageData = ctx.getImageData(0, 0, width, height);

  onProgress?.({ phase: 'Förbereder bild...', percent: 5 });
  const pixels = ditherToMonochrome(imageData);

  const widthBytes = Math.ceil(width / 8);
  const bitmapData = new Uint8Array(widthBytes * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[y * width + x] === 0) {
        bitmapData[y * widthBytes + Math.floor(x / 8)] |= (1 << (7 - (x % 8)));
      }
    }
  }

  console.log(`[Printer] ${PRINTER_VERSION}: dither ${width}x${height}, ${bitmapData.length} bytes, copies=${copies}`);

  for (let copy = 0; copy < copies; copy++) {
    const copyLabel = copies > 1 ? ` (${copy + 1}/${copies})` : '';
    await sendRasterJob(connection, bitmapData, widthBytes, height, settings, onProgress, copyLabel);
    if (copy < copies - 1) await delay(2000);
  }

  onProgress?.({ phase: 'Klar!', percent: 100 });
}

/**
 * Bypass image pipeline: no scaling, no dithering.
 * Requires 384px width and packs the canvas directly with thresholding.
 */
export async function printBitmapBypassProcessing(
  connection: PrinterConnection,
  canvas: HTMLCanvasElement,
  copies: number = 1,
  settings: PrintSettings = DEFAULT_PRINT_SETTINGS,
  onProgress?: (p: PrintProgress) => void,
): Promise<void> {
  if (canvas.width !== 384) {
    throw new Error(`Bypass kräver 384px bredd (fick ${canvas.width}px).`);
  }

  onProgress?.({ phase: 'Förbereder bild (bypass)...', percent: 5 });
  const { width, height, widthBytes, bitmapData } = packThresholdBitmap(canvas);

  console.log(`[Printer] ${PRINTER_VERSION}: bypass ${width}x${height}, ${bitmapData.length} bytes, copies=${copies}`);

  for (let copy = 0; copy < copies; copy++) {
    const copyLabel = copies > 1 ? ` (${copy + 1}/${copies})` : '';
    await sendRasterJob(connection, bitmapData, widthBytes, height, settings, onProgress, copyLabel);
    if (copy < copies - 1) await delay(2000);
  }

  onProgress?.({ phase: 'Klar!', percent: 100 });
}

/**
 * Print the exact debug test pattern (frame + cross) using raw bitmap data.
 * This is the PROVEN working pattern — no canvas, no dithering.
 * Uses the shared sendRasterJob engine.
 */
export async function printDebugTestPattern(
  connection: PrinterConnection,
  onProgress?: (p: PrintProgress) => void,
  settings: PrintSettings = DEFAULT_PRINT_SETTINGS,
): Promise<void> {
  const widthBytes = 48; // 384 pixels
  const patH = 520;
  const leadInRows = 10;
  const trailRows = 25;
  const height = patH + leadInRows + trailRows; // 555

  const rasterData = new Uint8Array(widthBytes * height);
  rasterData.fill(0x00);

  const w = widthBytes * 8; // 384
  const xMin = 0;
  const rightMargin = 16;
  const xMax = w - 1 - rightMargin;
  const contentW = xMax - xMin;

  const setPixel = (row: number, px: number) => {
    if (px < 0 || px >= w) return;
    rasterData[row + Math.floor(px / 8)] |= (1 << (7 - (px % 8)));
  };

  for (let py = 0; py < patH; py++) {
    const y = py + leadInRows;
    const row = y * widthBytes;
    if (py < 2 || py >= patH - 2) {
      for (let px = xMin; px <= xMax; px++) setPixel(row, px);
      continue;
    }
    for (let dx = 0; dx < 2; dx++) {
      setPixel(row, xMin + dx);
      setPixel(row, xMax - dx);
    }
    const xA = xMin + Math.floor((py / (patH - 1)) * contentW);
    const xB = xMin + Math.floor(((patH - 1 - py) / (patH - 1)) * contentW);
    for (const xPos of [xA, xB]) {
      for (let dx = -1; dx <= 1; dx++) setPixel(row, xPos + dx);
    }
    const cx = Math.floor((xMin + xMax) / 2);
    setPixel(row, cx);
    setPixel(row, cx + 1);
  }
  // Midline
  for (let dy = -1; dy <= 0; dy++) {
    const my = leadInRows + Math.floor(patH / 2) + dy;
    const row = my * widthBytes;
    for (let px = xMin; px <= xMax; px++) setPixel(row, px);
  }

  console.log(`[Printer] Debug pattern: ${w}x${height}, ${rasterData.length} bytes`);
  await sendRasterJob(connection, rasterData, widthBytes, height, settings, onProgress);
}

/**
 * Print a test page using canvas (goes through dithering pipeline).
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

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 384, 240);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, 384, 10);
  ctx.fillRect(0, 230, 384, 10);
  ctx.fillRect(0, 0, 10, 240);
  ctx.fillRect(374, 0, 10, 240);
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#000000';
  ctx.beginPath();
  ctx.moveTo(20, 20); ctx.lineTo(364, 220);
  ctx.moveTo(364, 20); ctx.lineTo(20, 220);
  ctx.stroke();
  ctx.fillRect(132, 100, 120, 40);

  await printBitmap(connection, canvas, 1, DEFAULT_PRINT_SETTINGS, onProgress);
}

/**
 * Floyd-Steinberg dithering → array of 0 (black) or 255 (white).
 */
function ditherToMonochrome(imageData: ImageData): Uint8Array {
  const w = imageData.width;
  const h = imageData.height;
  const data = imageData.data;

  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3];
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