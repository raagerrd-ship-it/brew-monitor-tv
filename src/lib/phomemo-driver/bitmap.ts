/**
 * Phomemo M110 Thermal Printer Driver — Bitmap Processing
 *
 * Floyd-Steinberg dithering and threshold packing for 1-bit monochrome.
 * No DOM dependencies beyond Canvas/ImageData.
 */

/**
 * Floyd-Steinberg dithering → array of 0 (black) or 255 (white).
 */
export function ditherToMonochrome(imageData: ImageData): Uint8Array {
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

/**
 * Pack canvas to 1-bit bitmap with simple threshold (no dithering).
 */
export function packThresholdBitmap(canvas: HTMLCanvasElement): {
  width: number;
  height: number;
  widthBytes: number;
  bitmapData: Uint8Array;
} {
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not read canvas context for printing.');

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
 * Pack dithered pixel array (0=black, 255=white) into 1-bit packed bitmap.
 */
export function packDitheredPixels(
  pixels: Uint8Array,
  width: number,
  height: number,
): { widthBytes: number; bitmapData: Uint8Array } {
  const widthBytes = Math.ceil(width / 8);
  const bitmapData = new Uint8Array(widthBytes * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[y * width + x] === 0) {
        bitmapData[y * widthBytes + Math.floor(x / 8)] |= (1 << (7 - (x % 8)));
      }
    }
  }
  return { widthBytes, bitmapData };
}
