import { BgSettings, simpleHash, fetchAndDecodeJpeg, processBackground, processWidgetThumbnail } from "./image-processing.ts";

// Upload base64 image to storage and return public URL
async function uploadBackground(
  supabase: any,
  base64DataUrl: string,
  fileName: string,
): Promise<string | null> {
  try {
    const base64 = base64DataUrl.replace(/^data:image\/\w+;base64,/, '');
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));

    const { error } = await supabase.storage
      .from('sonos-backgrounds')
      .upload(fileName, bytes, {
        contentType: 'image/jpeg',
        upsert: true,
      });

    if (error) {
      console.error('[SonosSync] Upload error:', error.message);
      return null;
    }

    const { data: urlData } = supabase.storage
      .from('sonos-backgrounds')
      .getPublicUrl(fileName);

    return urlData?.publicUrl ? `${urlData.publicUrl}?v=${Date.now()}` : null;
  } catch (error) {
    console.error('[SonosSync] Upload failed:', error);
    return null;
  }
}

// Check if a background file already exists in storage
async function backgroundExists(supabase: any, fileName: string): Promise<string | null> {
  const { data } = await supabase.storage
    .from('sonos-backgrounds')
    .list('', { search: fileName, limit: 1 });

  if (data && data.length > 0 && data[0].name === fileName) {
    const { data: urlData } = supabase.storage
      .from('sonos-backgrounds')
      .getPublicUrl(fileName);
    return urlData?.publicUrl || null;
  }
  return null;
}

// Clean up old background files, keeping only the specified ones
export async function cleanupOldBackgrounds(supabase: any, keepFileNames: string[]) {
  try {
    const { data: files } = await supabase.storage
      .from('sonos-backgrounds')
      .list('', { limit: 50 });

    if (!files || files.length <= 10) return;

    const toDelete = files
      .filter((f: any) => !keepFileNames.includes(f.name))
      .slice(0, files.length - 5)
      .map((f: any) => f.name);

    if (toDelete.length > 0) {
      await supabase.storage.from('sonos-backgrounds').remove(toDelete);
      console.log(`[SonosSync] Cleaned up ${toDelete.length} old backgrounds`);
    }
  } catch {
    // Non-critical, ignore
  }
}

// Resolve background + widget thumbnail: check cache, generate if needed
export async function resolveBackgroundAndWidget(
  supabase: any,
  artUrl: string | null,
  trackId: string,
  settings: BgSettings,
  targetW: number,
  targetH: number,
  cachedWidgetUrl?: string | null,
  forceRegenerate?: boolean,
): Promise<{ bgUrl: string | null; widgetUrl: string | null }> {
  if (!artUrl) return { bgUrl: null, widgetUrl: null };

  const trackHash = simpleHash(trackId || artUrl);
  const settingsHash = simpleHash(`${settings.blur}-${settings.brightness}-${settings.contrast}-${settings.saturation}-${settings.topGradientOpacity}-${settings.topGradientHeight}`);
  const bgFileName = `${trackHash}-${settingsHash}-${targetW}x${targetH}-v8.jpg`;
  const widgetFileName = `${trackHash}-widget-v1.jpg`;

  // Check cache: skip if forceRegenerate for bg (always regenerate bg on demand)
  const [existingBg, existingWidget] = await Promise.all([
    forceRegenerate ? Promise.resolve(null) : backgroundExists(supabase, bgFileName),
    cachedWidgetUrl ? Promise.resolve(cachedWidgetUrl) : backgroundExists(supabase, widgetFileName),
  ]);

  if (existingBg && existingWidget) {
    console.log(`[SonosSync] Cache hit: ${bgFileName} + widget`);
    return { bgUrl: existingBg, widgetUrl: existingWidget };
  }

  // Need source image — fetch once, process both
  const decoded = await fetchAndDecodeJpeg(artUrl);
  if (!decoded) return { bgUrl: existingBg, widgetUrl: existingWidget };

  const results: { bgUrl: string | null; widgetUrl: string | null } = {
    bgUrl: existingBg,
    widgetUrl: existingWidget,
  };

  // Generate missing images in parallel
  const uploads: Promise<void>[] = [];

  if (!existingBg) {
    console.log(`[SonosSync] Generating BG: ${bgFileName}`);
    const bgBase64 = processBackground(decoded.data, decoded.width, decoded.height, targetW, targetH, settings);
    uploads.push(
      uploadBackground(supabase, bgBase64, bgFileName).then(url => { results.bgUrl = url; })
    );
  }

  if (!existingWidget) {
    console.log(`[SonosSync] Generating widget thumbnail: ${widgetFileName}`);
    const widgetBase64 = processWidgetThumbnail(decoded.data, decoded.width, decoded.height);
    uploads.push(
      uploadBackground(supabase, widgetBase64, widgetFileName).then(url => { results.widgetUrl = url; })
    );
  }

  await Promise.all(uploads);
  return results;
}
