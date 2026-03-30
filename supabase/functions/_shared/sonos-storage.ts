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

// Verify that a public storage URL still points to an existing object.
export async function storageObjectExistsByPublicUrl(supabase: any, publicUrl: string): Promise<boolean> {
  try {
    const fileName = fileNameFromUrl(publicUrl);
    if (!fileName) return false;

    const { data } = await supabase.storage
      .from('sonos-backgrounds')
      .list('', { search: fileName, limit: 1 });

    return !!data?.some((f: any) => f.name === fileName);
  } catch {
    return false;
  }
}

// Delete ALL files in bucket except those actively referenced by the given URLs.
// Pass an empty array to delete everything (e.g. on IDLE transition).
export async function cleanupUnreferencedBackgrounds(supabase: any, referencedUrls: (string | null | undefined)[]) {
  // Bridge-uploaded files are managed by the bridge — never delete them
  const BRIDGE_FILES = new Set(['bridge-current.jpg', 'bridge-next.jpg']);

  try {
    const keepNames = new Set(
      referencedUrls
        .filter(Boolean)
        .map(url => fileNameFromUrl(url!))
        .filter(Boolean) as string[]
    );
    // Always protect bridge files
    for (const bf of BRIDGE_FILES) keepNames.add(bf);

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

// Resolve background + widget thumbnail: always regenerate (no caching)
export async function resolveBackgroundAndWidget(
  supabase: any,
  artUrl: string | null,
  trackId: string,
  settings: BgSettings,
  targetW: number,
  targetH: number,
  _cachedWidgetUrl?: string | null,
  _forceRegenerate?: boolean,
  trackName?: string | null,
): Promise<{ bgUrl: string | null; widgetUrl: string | null }> {
  if (!artUrl) return { bgUrl: null, widgetUrl: null };

  const trackHash = simpleHash(trackId || artUrl);
  const settingsHash = simpleHash(`${settings.blur}-${settings.brightness}-${settings.contrast}-${settings.saturation}-${settings.topGradientOpacity}-${settings.topGradientHeight}`);
  const namePart = trackName
    ? '-' + trackName.toLowerCase()
        .replace(/å/g, 'a').replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u')
        .replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
    : '';
  const bgFileName = `${trackHash}${namePart}-${settingsHash}-${targetW}x${targetH}-v8.jpg`;
  const widgetFileName = `${trackHash}${namePart}-widget-v1.jpg`;

  // Always fetch source and regenerate
  const decoded = await fetchAndDecodeJpeg(artUrl);
  if (!decoded) return { bgUrl: null, widgetUrl: null };

  console.log(`[SonosSync] Generating BG: ${bgFileName}`);
  const bgBase64 = processBackground(decoded.data, decoded.width, decoded.height, targetW, targetH, settings);
  const widgetBase64 = processWidgetThumbnail(decoded.data, decoded.width, decoded.height);

  const [bgUrl, widgetUrl] = await Promise.all([
    uploadBackground(supabase, bgBase64, bgFileName),
    uploadBackground(supabase, widgetBase64, widgetFileName),
  ]);

  return { bgUrl, widgetUrl };
}
