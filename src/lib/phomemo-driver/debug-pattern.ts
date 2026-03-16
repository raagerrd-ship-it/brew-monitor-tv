/**
 * Phomemo M110 Thermal Printer Driver — Debug Test Pattern
 *
 * Generates a frame + cross pattern using raw bitmap data (no canvas).
 * Uses the shared sendRasterJob engine.
 */

import type { PrinterConnection, PrintSettings, PrintProgress } from './types';
import { DEFAULT_PRINT_SETTINGS } from './constants';
import { sendRasterJob } from './protocol';

/**
 * Print the debug test pattern (frame + cross) using raw bitmap data.
 * This is the PROVEN working pattern — no canvas, no dithering.
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
  const { printBitmap } = await import('./protocol');
  const { DEFAULT_PRINT_SETTINGS: defaults } = await import('./constants');

  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 240;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create test canvas.');

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

  await printBitmap(connection, canvas, 1, defaults, onProgress);
}
