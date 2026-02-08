import { decode as decodeJpeg, encode as encodeJpeg } from "npm:jpeg-js@0.4.4";

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
    offsetY = Math.round((srcH - cropH) / 2);
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

// Apply blur via multi-pass downscale-upscale for smooth results
function applyBlur(pixels: Uint8Array, w: number, h: number, blur: number): Uint8Array {
  if (blur <= 0) return pixels;

  // Number of passes scales with blur (blur=40 -> 3, blur=100 -> 7, blur=200 -> 8)
  const passes = Math.max(2, Math.min(8, Math.round(blur / 15)));
  // Each pass uses a moderate downscale factor (2-8x) to produce visible blur
  const perPassFactor = Math.max(2, Math.min(8, Math.round(blur / passes / 2)));

  let result = pixels;
  for (let i = 0; i < passes; i++) {
    const smallW = Math.max(4, Math.round(w / perPassFactor));
    const smallH = Math.max(4, Math.round(h / perPassFactor));
    const small = resizeBilinear(result, w, h, smallW, smallH);
    result = resizeBilinear(small, smallW, smallH, w, h);
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
  const fadeLength = solidHeight; // fade over equal distance below solid region
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

// Encode pixel data to base64 JPEG data URL
function pixelsToBase64Jpeg(pixels: Uint8Array, w: number, h: number, quality: number): string {
  const encoded = encodeJpeg({ data: pixels, width: w, height: h }, quality);
  const bytes = new Uint8Array(encoded.data);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

// Check if URL is a private/local address
export function isPrivateUrl(url: string): boolean {
  return /192\.168\.|10\.\d|172\.(1[6-9]|2\d|3[01])\.|localhost|127\.0\.0\.1|getaa/.test(url);
}

// Fetch and decode a JPEG from URL
export async function fetchAndDecodeJpeg(url: string): Promise<{ data: Uint8Array; width: number; height: number } | null> {
  if (isPrivateUrl(url)) {
    console.log('[SonosSync] Skipping fetch for private URL');
    return null;
  }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    const decoded = decodeJpeg(new Uint8Array(buffer), { useTArray: true, formatAsRGBA: true });
    return { data: decoded.data, width: decoded.width, height: decoded.height };
  } catch (e) {
    console.error('[SonosSync] Fetch/decode failed:', e);
    return null;
  }
}

// Generate a processed background image (blur, color adjustments, gradient)
export function processBackground(
  srcData: Uint8Array, srcW: number, srcH: number,
  targetW: number, targetH: number,
  settings: BgSettings,
): string {
  const targetAspect = targetW / targetH;
  const cropped = cropToAspectRatio(srcData, srcW, srcH, targetAspect);
  let pixels = resizeBilinear(cropped.data, cropped.width, cropped.height, targetW, targetH);

  pixels = applyBlur(pixels, targetW, targetH, settings.blur);
  applyColorAdjustments(pixels, targetW, targetH, settings.brightness, settings.contrast, settings.saturation);
  applyTopGradient(pixels, targetW, targetH, settings.topGradientOpacity, settings.topGradientHeight);

  return pixelsToBase64Jpeg(pixels, targetW, targetH, 85);
}

// Generate a widget thumbnail (280x130 center-cropped)
export function processWidgetThumbnail(
  srcData: Uint8Array, srcW: number, srcH: number,
): string {
  const WIDGET_W = 280;
  const WIDGET_H = 130;
  const targetAspect = WIDGET_W / WIDGET_H;
  const cropped = cropToAspectRatio(srcData, srcW, srcH, targetAspect);
  const pixels = resizeBilinear(cropped.data, cropped.width, cropped.height, WIDGET_W, WIDGET_H);
  return pixelsToBase64Jpeg(pixels, WIDGET_W, WIDGET_H, 80);
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
