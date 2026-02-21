/**
 * Web Bluetooth communication with Phomemo M110 thermal printer.
 * Uses ESC/POS raster bitmap commands (GS v 0) for 1-bit image printing.
 * 
 * Label size: 70x50mm at 203 DPI = 559x399 pixels
 */

// Known Phomemo M110 BLE UUIDs
const PHOMEMO_SERVICE_UUID = '0000ff00-0000-1000-8000-00805f9b34fb';
const PHOMEMO_CHAR_UUID = '0000ff02-0000-1000-8000-00805f9b34fb';

// Chunk size for BLE writes (bytes)
const BLE_CHUNK_SIZE = 100;
const BLE_CHUNK_DELAY_MS = 20;

export interface PrinterConnection {
  device: any;
  characteristic: any;
}

/** Check if Web Bluetooth is supported */
export function isBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in (navigator as any);
}

/** Connect to a Phomemo M110 printer via Web Bluetooth */
export async function connectPrinter(): Promise<PrinterConnection> {
  if (!isBluetoothSupported()) {
    throw new Error('Web Bluetooth stöds inte i denna webbläsare. Använd Chrome eller Edge.');
  }

  const device = await (navigator as any).bluetooth.requestDevice({
    filters: [{ namePrefix: 'M110' }, { namePrefix: 'M120' }, { namePrefix: 'Phomemo' }],
    optionalServices: [PHOMEMO_SERVICE_UUID],
  });

  const server = await device.gatt!.connect();
  const service = await server.getPrimaryService(PHOMEMO_SERVICE_UUID);
  const characteristic = await service.getCharacteristic(PHOMEMO_CHAR_UUID);

  return { device, characteristic };
}

/** Disconnect from printer */
export function disconnectPrinter(connection: PrinterConnection): void {
  try {
    connection.device.gatt?.disconnect();
  } catch {
    // Ignore disconnect errors
  }
}

/** Send raw bytes in chunks */
async function sendChunked(char: any, data: Uint8Array): Promise<void> {
  for (let offset = 0; offset < data.length; offset += BLE_CHUNK_SIZE) {
    const chunk = data.slice(offset, offset + BLE_CHUNK_SIZE);
    await char.writeValueWithoutResponse(chunk);
    if (offset + BLE_CHUNK_SIZE < data.length) {
      await new Promise(r => setTimeout(r, BLE_CHUNK_DELAY_MS));
    }
  }
}

/** Helper: delay */
function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Convert canvas to 1-bit bitmap and print via ESC/POS GS v 0.
 * Canvas should be 559x399 pixels (70x50mm at 203 DPI).
 */
export async function printBitmap(
  connection: PrinterConnection,
  canvas: HTMLCanvasElement,
  copies: number = 1
): Promise<void> {
  const ctx = canvas.getContext('2d')!;
  const width = canvas.width;
  const height = canvas.height;
  const imageData = ctx.getImageData(0, 0, width, height);
  
  // Apply Floyd-Steinberg dithering and convert to 1-bit
  const pixels = ditherToMonochrome(imageData);
  
  // Width in bytes (8 pixels per byte)
  const bytesPerRow = Math.ceil(width / 8);
  
  // Build raster bitmap data
  const bitmapData = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[y * width + x] === 0) {
        // Black pixel = 1 bit set (printer prints dark)
        const byteIdx = y * bytesPerRow + Math.floor(x / 8);
        const bitIdx = 7 - (x % 8);
        bitmapData[byteIdx] |= (1 << bitIdx);
      }
    }
  }

  for (let copy = 0; copy < copies; copy++) {
    // ESC/POS: Initialize printer
    await sendChunked(connection.characteristic, new Uint8Array([0x1B, 0x40]));
    await delay(50);

    // GS v 0 - Print raster bitmap
    // Format: 1D 76 30 m xL xH yL yH [data]
    const header = new Uint8Array([
      0x1D, 0x76, 0x30, 0x00,
      bytesPerRow & 0xFF, (bytesPerRow >> 8) & 0xFF,
      height & 0xFF, (height >> 8) & 0xFF,
    ]);
    
    // Combine header + bitmap
    const fullData = new Uint8Array(header.length + bitmapData.length);
    fullData.set(header, 0);
    fullData.set(bitmapData, header.length);
    
    await sendChunked(connection.characteristic, fullData);
    await delay(200);
    
    // Feed some paper after printing
    await sendChunked(connection.characteristic, new Uint8Array([0x1B, 0x64, 0x03]));
    await delay(300);

    if (copy < copies - 1) {
      await delay(500);
    }
  }
}

/**
 * Floyd-Steinberg dithering: converts RGBA image data to array of 0 (black) or 255 (white).
 */
function ditherToMonochrome(imageData: ImageData): Uint8Array {
  const w = imageData.width;
  const h = imageData.height;
  const data = imageData.data;
  
  // Convert to grayscale float array
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const a = data[i * 4 + 3];
    // Blend with white background for transparent pixels
    const alpha = a / 255;
    gray[i] = (0.299 * r + 0.587 * g + 0.114 * b) * alpha + 255 * (1 - alpha);
  }
  
  // Floyd-Steinberg dithering
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
