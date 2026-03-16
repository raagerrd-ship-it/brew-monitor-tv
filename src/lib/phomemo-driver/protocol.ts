/**
 * Phomemo M110 Thermal Printer Driver — Raster Protocol
 *
 * M110/M120 raster job protocol following phomemo-tools + CUPS driver.
 * Single protocol path for all printing (labels, debug patterns, etc.).
 */

import type { PrinterConnection, PrintSettings, PrintProgress } from './types';
import { DEFAULT_PRINT_SETTINGS, PRINT_WIDTH_PX } from './constants';
import { bleWrite, sendChunked, setupNotifyChannel, delay } from './connection';
import { ditherToMonochrome, packThresholdBitmap, packDitheredPixels } from './bitmap';

function mediaTypeCode(mt: string): number | null {
  if (mt === 'gap') return 0x0a;
  if (mt === 'continuous') return 0x0b;
  if (mt === 'mark') return 0x26;
  return null;
}

/**
 * Send pre-built 1-bit raster data to the printer.
 * This is the core protocol engine used by all print functions.
 */
export async function sendRasterJob(
  connection: PrinterConnection,
  rasterData: Uint8Array,
  widthBytes: number,
  height: number,
  settings: PrintSettings = DEFAULT_PRINT_SETTINGS,
  onProgress?: (p: PrintProgress) => void,
  copyDetail?: string,
): Promise<void> {
  onProgress?.({ phase: 'sending_settings', percent: 10, detail: copyDetail });

  const notify = await setupNotifyChannel(connection, msg => console.log(msg));
  try {
    // ── Setup commands ──
    await bleWrite(connection, new Uint8Array([0x1b, 0x40]), 'init');
    await delay(300);

    await bleWrite(connection, new Uint8Array([0x1f, 0x11, 0x02, 0x00]), 'start-job');
    await delay(200);

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
    onProgress?.({ phase: 'sending_header', percent: 15, detail: copyDetail });
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
    onProgress?.({ phase: 'printing', percent: 20, detail: copyDetail });
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
        onProgress?.({ phase: 'printing', percent: Math.min(95, pct), detail: copyDetail });
      },
    );

    // Wait for printer to process raster data
    onProgress?.({ phase: 'waiting', percent: 95, detail: copyDetail });
    await delay(3000);

    // Form feed — advance to next gap position
    await bleWrite(connection, new Uint8Array([0x0c]), 'form-feed');
    await delay(500);

    // End-job + optional ACK wait
    onProgress?.({ phase: 'finishing', percent: 96, detail: copyDetail });
    notify?.clear();
    await bleWrite(connection, new Uint8Array([0x1f, 0x11, 0x03, 0x00]), 'end-job');
    await notify?.waitForPacket('ACK after end-job', 5000);
    await delay(600);
  } finally {
    await notify?.stop();
  }
}

/**
 * Print canvas with full pipeline: optional scale to 384px + Floyd-Steinberg dithering.
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
  if (canvas.width !== PRINT_WIDTH_PX) {
    const scaled = document.createElement('canvas');
    const scaledHeight = Math.max(1, Math.round((canvas.height * PRINT_WIDTH_PX) / canvas.width));
    scaled.width = PRINT_WIDTH_PX;
    scaled.height = scaledHeight;
    const sctx = scaled.getContext('2d');
    if (!sctx) throw new Error('Could not scale canvas for printing.');
    sctx.imageSmoothingEnabled = false;
    sctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, scaled.width, scaled.height);
    workingCanvas = scaled;
    console.log(`[Printer] Rescaled ${canvas.width}x${canvas.height} → ${scaled.width}x${scaled.height}`);
  }

  const width = workingCanvas.width;
  const height = workingCanvas.height;
  const ctx = workingCanvas.getContext('2d')!;
  const imageData = ctx.getImageData(0, 0, width, height);

  onProgress?.({ phase: 'preparing', percent: 5 });
  const pixels = ditherToMonochrome(imageData);
  const { widthBytes, bitmapData } = packDitheredPixels(pixels, width, height);

  console.log(`[Printer] ${PRINT_WIDTH_PX}px dither ${width}x${height}, ${bitmapData.length} bytes, copies=${copies}`);

  for (let copy = 0; copy < copies; copy++) {
    const detail = copies > 1 ? `copy ${copy + 1}/${copies}` : undefined;
    await sendRasterJob(connection, bitmapData, widthBytes, height, settings, onProgress, detail);
    if (copy < copies - 1) await delay(2000);
  }

  onProgress?.({ phase: 'done', percent: 100 });
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
  if (canvas.width !== PRINT_WIDTH_PX) {
    throw new Error(`Bypass requires ${PRINT_WIDTH_PX}px width (got ${canvas.width}px).`);
  }

  onProgress?.({ phase: 'preparing', percent: 5, detail: 'bypass' });
  const { width, height, widthBytes, bitmapData } = packThresholdBitmap(canvas);

  console.log(`[Printer] bypass ${width}x${height}, ${bitmapData.length} bytes, copies=${copies}`);

  for (let copy = 0; copy < copies; copy++) {
    const detail = copies > 1 ? `copy ${copy + 1}/${copies}` : undefined;
    await sendRasterJob(connection, bitmapData, widthBytes, height, settings, onProgress, detail);
    if (copy < copies - 1) await delay(2000);
  }

  onProgress?.({ phase: 'done', percent: 100 });
}
