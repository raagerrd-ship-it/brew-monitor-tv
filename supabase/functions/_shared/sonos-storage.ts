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

    if (!urlData?.publicUrl) return null;

    // Get file metadata for stable cache-buster (consistent with backgroundExists)
    const { data: files } = await supabase.storage
      .from('sonos-backgrounds')
      .list('', { search: fileName, limit: 1 });
    const file = files?.find((f: any) => f.name === fileName);
    const fileTs = file ? new Date(file.updated_at || file.created_at).getTime() : Date.now();
    return `${urlData.publicUrl}?v=${fileTs}`;
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

  const file = data?.find((f: any) => f.name === fileName);
  if (file) {
    const { data: urlData } = supabase.storage
      .from('sonos-backgrounds')
      .getPublicUrl(fileName);
    // Use file's updated_at as stable cache-buster so browsers can cache the image
    const fileTs = new Date(file.updated_at || file.created_at).getTime();
    return urlData?.publicUrl ? `${urlData.publicUrl}?v=${fileTs}` : null;
  }
  return null;
}

// Extract filename from a storage public URL (e.g. "...sonos-backgrounds/abc.jpg?v=123" → "abc.jpg")
function fileNameFromUrl(url: string): string | null {
  try {
    const path = new URL(url).pathname;
    const parts = path.split('/');
    return parts[parts.length - 1] || null;
  } catch {
    // Fallback regex for non-standard URLs
    const match = url.match(/\/([^/?]+)\??/);
    return match ? match[1] : null;
  }
}

// Delete ALL files in bucket except those actively referenced by the given URLs.
// Pass an empty array to delete everything (e.g. on IDLE transition).
export async function cleanupUnreferencedBackgrounds(supabase: any, referencedUrls: (string | null | undefined)[]) {
  try {
    const keepNames = new Set(
      referencedUrls
        .filter(Boolean)
        .map(url => fileNameFromUrl(url!))
        .filter(Boolean) as string[]
    );

    const { data: files } = await supabase.storage
      .from('sonos-backgrounds')
      .list('', { limit: 100 });

    if (!files || files.length === 0) return;

    const toDelete = files
      .map((f: any) => f.name)
      .filter((name: string) => !keepNames.has(name));

    if (toDelete.length > 0) {
      await supabase.storage.from('sonos-backgrounds').remove(toDelete);
      console.log(`[SonosSync] Cleanup: deleted ${toDelete.length} unreferenced files, kept ${keepNames.size}`);
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
  trackName?: string | null,
): Promise<{ bgUrl: string | null; widgetUrl: string | null }> {
  if (!artUrl) return { bgUrl: null, widgetUrl: null };

  const trackHash = simpleHash(trackId || artUrl);
  const settingsHash = simpleHash(`${settings.blur}-${settings.brightness}-${settings.contrast}-${settings.saturation}-${settings.topGradientOpacity}-${settings.topGradientHeight}`);
  // Sanitize track name for filename: lowercase, replace non-alphanum with dash, trim
  const namePart = trackName
    ? '-' + trackName.toLowerCase().replace(/[^a-z0-9åäöü]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
    : '';
  const bgFileName = `${trackHash}${namePart}-${settingsHash}-${targetW}x${targetH}-v8.jpg`;
  const widgetFileName = `${trackHash}${namePart}-widget-v1.jpg`;

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
