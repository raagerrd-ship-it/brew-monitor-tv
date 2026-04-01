import { BgSettings, simpleHash, fetchAndDecodeJpeg, processBackground } from "./image-processing.ts";

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

// LRU cleanup: keep the newest MAX_CACHED files + bridge files + explicitly referenced URLs.
const MAX_CACHED = 200;
export async function cleanupUnreferencedBackgrounds(supabase: any, referencedUrls: (string | null | undefined)[]) {
  const BRIDGE_FILES = new Set(['bridge-current.jpg', 'bridge-next.jpg']);

  try {
    const keepNames = new Set(
      referencedUrls
        .filter(Boolean)
        .map(url => fileNameFromUrl(url!))
        .filter(Boolean) as string[]
    );
    for (const bf of BRIDGE_FILES) keepNames.add(bf);

    const { data: files } = await supabase.storage
      .from('sonos-backgrounds')
      .list('', { limit: 500 });

    if (!files || files.length <= MAX_CACHED) return;

    // Sort newest first by updated_at
    const sorted = [...files].sort((a: any, b: any) =>
      new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime()
    );

    const toDelete = sorted
      .slice(MAX_CACHED)
      .map((f: any) => f.name)
      .filter((name: string) => !keepNames.has(name));

    if (toDelete.length > 0) {
      await supabase.storage.from('sonos-backgrounds').remove(toDelete);
      console.log(`[SonosSync] LRU cleanup: deleted ${toDelete.length} old files, total was ${files.length}`);
    }
  } catch {
    // Non-critical, ignore
  }
}

// Resolve background image with cache support
export async function resolveBackground(
  supabase: any,
  artUrl: string | null,
  trackId: string,
  settings: BgSettings,
  targetW: number,
  targetH: number,
  _forceRegenerate?: boolean,
  trackName?: string | null,
): Promise<{ bgUrl: string | null, cached: boolean, generationMs: number }> {
  if (!artUrl) return { bgUrl: null, cached: false, generationMs: 0 };

  const t0 = Date.now();
  const trackHash = simpleHash(trackId || artUrl);
  const settingsHash = simpleHash(`${settings.blur}-${settings.brightness}-${settings.contrast}-${settings.saturation}-${settings.topGradientOpacity}-${settings.topGradientHeight}`);
  const namePart = trackName
    ? '-' + trackName.toLowerCase()
        .replace(/å/g, 'a').replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u')
        .replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
    : '';
  const bgFileName = `${trackHash}${namePart}-${settingsHash}-${targetW}x${targetH}-v8.jpg`;

  // Cache check: skip if forceRegenerate
  if (!_forceRegenerate) {
    const { data: existing } = await supabase.storage
      .from('sonos-backgrounds')
      .list('', { search: bgFileName, limit: 1 });

    const cached = existing?.find((f: any) => f.name === bgFileName);
    if (cached) {
      const { data: urlData } = supabase.storage.from('sonos-backgrounds').getPublicUrl(bgFileName);
      const ts = new Date(cached.updated_at || cached.created_at).getTime();
      const elapsed = Date.now() - t0;
      console.log(`[SonosSync] Cache hit: ${bgFileName} (${elapsed}ms)`);
      return { bgUrl: `${urlData.publicUrl}?v=${ts}`, cached: true, generationMs: elapsed };
    }
  }

  // Cache miss — fetch, process, upload
  const decoded = await fetchAndDecodeJpeg(artUrl);
  if (!decoded) return { bgUrl: null, cached: false, generationMs: Date.now() - t0 };

  console.log(`[SonosSync] Generating BG: ${bgFileName}`);
  const bgBase64 = processBackground(decoded.data, decoded.width, decoded.height, targetW, targetH, settings);

  const bgUrl = await uploadBackground(supabase, bgBase64, bgFileName);
  const elapsed = Date.now() - t0;
  console.log(`[SonosSync] Generated BG in ${elapsed}ms: ${bgFileName}`);

  return { bgUrl, cached: false, generationMs: elapsed };
}
