// jpeg-js laddas bara i grenen som faktiskt bearbetar en bild
const jpeg = () => import("npm:jpeg-js@0.4.4");

export interface BgSettings {
  blur: number;
  brightness: number;
  contrast: number;
  saturation: number;
  topGradientOpacity: number;
  topGradientHeight: number;
}

// Center-crop source pixels to target aspect ratio
export function cropToAspectRatio(
  srcData: Uint8Array, srcW: number, srcH: number,
  targetAspect: number,
): { data: Uint8Array; width: number; height: number } {
  const srcAspect = srcW / srcH;
  let cropW: number, cropH: number, offsetX: number, offsetY: number;

  if (srcAspect > targetAspect) {
    cropH = srcH;
    cropW = Math.min(Math.round(srcH * targetAspect), srcW);
    offsetX = Math.round((srcW - cropW) / 2);
    offsetY = 0;
  } else {
    cropW = srcW;
    cropH = Math.min(Math.round(srcW / targetAspect), srcH);
    offsetX = 0;
    offsetY = 0; // Top-aligned vertically
  }

  const cropped = new Uint8Array(cropW * cropH * 4);
  for (let y = 0; y < cropH; y++) {
    const srcStart = ((offsetY + y) * srcW + offsetX) * 4;
    const dstStart = y * cropW * 4;
    cropped.set(srcData.subarray(srcStart, srcStart + cropW * 4), dstStart);
  }

  return { data: cropped, width: cropW, height: cropH };
}

// Bilinear resize of RGBA pixel data
export function resizeBilinear(
  src: Uint8Array, srcW: number, srcH: number,
  dstW: number, dstH: number
): Uint8Array {
  const dst = new Uint8Array(dstW * dstH * 4);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;

  for (let y = 0; y < dstH; y++) {
    const srcY = y * yRatio;
    const y0 = Math.floor(srcY);
    const y1 = Math.min(y0 + 1, srcH - 1);
    const yFrac = srcY - y0;

    for (let x = 0; x < dstW; x++) {
      const srcX = x * xRatio;
      const x0 = Math.floor(srcX);
      const x1 = Math.min(x0 + 1, srcW - 1);
      const xFrac = srcX - x0;

      const dstIdx = (y * dstW + x) * 4;
      const i00 = (y0 * srcW + x0) * 4;
      const i10 = (y0 * srcW + x1) * 4;
      const i01 = (y1 * srcW + x0) * 4;
      const i11 = (y1 * srcW + x1) * 4;

      for (let c = 0; c < 4; c++) {
        const top = src[i00 + c] + (src[i10 + c] - src[i00 + c]) * xFrac;
        const bot = src[i01 + c] + (src[i11 + c] - src[i01 + c]) * xFrac;
        dst[dstIdx + c] = Math.round(top + (bot - top) * yFrac);
      }
    }
  }
  return dst;
}

// Separable box blur pass (horizontal then vertical) using sliding window
function boxBlurPass(src: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const dst = new Uint8Array(src.length);
  const tmp = new Uint8Array(src.length);

  // Horizontal pass: src -> tmp
  for (let y = 0; y < h; y++) {
    const rowOff = y * w * 4;
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      const left0 = 0;
      const right0 = Math.min(radius, w - 1);
      for (let x = left0; x <= right0; x++) sum += src[rowOff + x * 4 + c];
      let count = right0 - left0 + 1;

      for (let x = 0; x < w; x++) {
        tmp[rowOff + x * 4 + c] = (sum / count + 0.5) | 0;
        // Expand right
        const nr = x + radius + 1;
        if (nr < w) { sum += src[rowOff + nr * 4 + c]; count++; }
        // Shrink left
        const nl = x - radius;
        if (nl >= 0) { sum -= src[rowOff + nl * 4 + c]; count--; }
      }
    }
    // Copy alpha
    for (let x = 0; x < w; x++) tmp[rowOff + x * 4 + 3] = src[rowOff + x * 4 + 3];
  }

  // Vertical pass: tmp -> dst
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      const top0 = 0;
      const bot0 = Math.min(radius, h - 1);
      for (let y = top0; y <= bot0; y++) sum += tmp[(y * w + x) * 4 + c];
      let count = bot0 - top0 + 1;

      for (let y = 0; y < h; y++) {
        dst[(y * w + x) * 4 + c] = (sum / count + 0.5) | 0;
        const nb = y + radius + 1;
        if (nb < h) { sum += tmp[(nb * w + x) * 4 + c]; count++; }
        const nt = y - radius;
        if (nt >= 0) { sum -= tmp[(nt * w + x) * 4 + c]; count--; }
      }
    }
    // Copy alpha
    for (let y = 0; y < h; y++) dst[(y * w + x) * 4 + 3] = tmp[(y * w + x) * 4 + 3];
  }

  return dst;
}

// Apply blur via 3-pass box blur (approximates Gaussian blur)
function applyBlur(pixels: Uint8Array, w: number, h: number, blur: number): Uint8Array {
  if (blur <= 0) return pixels;
  const radius = Math.max(1, Math.round(blur / 2));
  let result = pixels;
  for (let i = 0; i < 3; i++) {
    result = boxBlurPass(result, w, h, radius);
  }
  return result;
}

// Measure average luminance of pixel data
function measureAverageLuminance(pixels: Uint8Array, w: number, h: number): number {
  const len = w * h * 4;
  let sum = 0;
  for (let i = 0; i < len; i += 4) {
    sum += 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
  }
  return sum / (w * h);
}

// Apply normalized brightness, contrast, saturation adjustments in-place
// brightness is now a target luminance (0-255) instead of a multiplier
function applyColorAdjustments(
  pixels: Uint8Array, w: number, h: number,
  targetLuminance: number, contrast: number, saturation: number,
): void {
  const avgLum = measureAverageLuminance(pixels, w, h);
  const scale = avgLum > 0 ? targetLuminance / avgLum : 0;

  const len = w * h * 4;
  for (let i = 0; i < len; i += 4) {
    let r = pixels[i] * scale;
    let g = pixels[i + 1] * scale;
    let b = pixels[i + 2] * scale;

    r = ((r - 128) * contrast) + 128;
    g = ((g - 128) * contrast) + 128;
    b = ((b - 128) * contrast) + 128;

    if (saturation !== 1.0) {
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      r = lum + (r - lum) * saturation;
      g = lum + (g - lum) * saturation;
      b = lum + (b - lum) * saturation;
    }

    pixels[i] = Math.max(0, Math.min(255, Math.round(r)));
    pixels[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
    pixels[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
  }
}

// Apply dark gradient at the top of the image
function applyTopGradient(
  pixels: Uint8Array, w: number, h: number,
  opacity: number, solidHeight: number,
): void {
  if (opacity <= 0 || solidHeight <= 0) return;
  const fadeLength = Math.round(solidHeight / 2); // fade over half the solid region height
  const totalHeight = Math.min(solidHeight + fadeLength, h);
  for (let y = 0; y < totalHeight; y++) {
    let factor: number;
    if (y < solidHeight) {
      // Solid dark region
      factor = 1 - opacity;
    } else {
      // Fade from dark to transparent
      const fadeProgress = (y - solidHeight) / fadeLength;
      factor = 1 - opacity * (1 - fadeProgress);
    }
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      pixels[idx] = Math.round(pixels[idx] * factor);
      pixels[idx + 1] = Math.round(pixels[idx + 1] * factor);
      pixels[idx + 2] = Math.round(pixels[idx + 2] * factor);
    }
  }
}

// Encode pixel data to JPEG bytes
async function encodeJpegBytes(pixels: Uint8Array, w: number, h: number, quality: number): Promise<Uint8Array> {
  const { encode } = await jpeg();
  return new Uint8Array(encode({ data: pixels, width: w, height: h }, quality).data);
}

// Decode JPEG bytes to RGBA
export async function decodeJpegBytes(bytes: Uint8Array): Promise<{ data: Uint8Array; width: number; height: number } | null> {
  try {
    const { decode } = await jpeg();
    const decoded = decode(bytes, { useTArray: true, formatAsRGBA: true });
    return { data: decoded.data, width: decoded.width, height: decoded.height };
  } catch (e) {
    console.error('[SonosSync] Decode failed:', e);
    return null;
  }
}

// Decode a base64 (optionally data-URL) image to bytes
export function base64ToBytes(b64: unknown): Uint8Array | null {
  if (typeof b64 !== 'string' || b64.length === 0) return null;
  return Uint8Array.from(atob(b64.replace(/^data:image\/\w+;base64,/, '')), c => c.charCodeAt(0));
}

/** Cheap content fingerprint of image bytes (radio keeps the same track name per song) */
export function artFingerprint(bytes: Uint8Array | null): string | null {
  if (!bytes || bytes.length === 0) return null;
  return simpleHash(`${bytes.length}-${bytes.subarray(0, 1024).join(',')}-${bytes.subarray(-1024).join(',')}`);
}

// Check if URL is a private/local address
export function isPrivateUrl(url: string): boolean {
  return /192\.168\.|10\.\d|172\.(1[6-9]|2\d|3[01])\.|localhost|127\.0\.0\.1|getaa/.test(url);
}

// Fetch raw image bytes from URL
export async function fetchImageBytes(url: string): Promise<Uint8Array | null> {
  if (isPrivateUrl(url)) {
    console.log('[SonosSync] Skipping fetch for private URL');
    return null;
  }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch (e) {
    console.error('[SonosSync] Fetch failed:', e);
    return null;
  }
}

// Generate a processed background image (blur, color adjustments, gradient)
export async function processBackground(
  srcData: Uint8Array, srcW: number, srcH: number,
  targetW: number, targetH: number,
  settings: BgSettings,
): Promise<Uint8Array> {
  const targetAspect = targetW / targetH;
  const cropped = cropToAspectRatio(srcData, srcW, srcH, targetAspect);
  let pixels = resizeBilinear(cropped.data, cropped.width, cropped.height, targetW, targetH);

  pixels = applyBlur(pixels, targetW, targetH, settings.blur);
  applyColorAdjustments(pixels, targetW, targetH, settings.brightness, settings.contrast, settings.saturation);
  applyTopGradient(pixels, targetW, targetH, settings.topGradientOpacity, settings.topGradientHeight);

  return encodeJpegBytes(pixels, targetW, targetH, 85);
}

// Generate a widget thumbnail (280x130 center-cropped)
export async function processWidgetThumbnail(
  srcData: Uint8Array, srcW: number, srcH: number,
): Promise<Uint8Array> {
  const WIDGET_W = 280;
  const WIDGET_H = 130;
  const targetAspect = WIDGET_W / WIDGET_H;
  const cropped = cropToAspectRatio(srcData, srcW, srcH, targetAspect);
  const pixels = resizeBilinear(cropped.data, cropped.width, cropped.height, WIDGET_W, WIDGET_H);
  return encodeJpegBytes(pixels, WIDGET_W, WIDGET_H, 80);
}

// Simple hash for track identification in filenames
export function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
