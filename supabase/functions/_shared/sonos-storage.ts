import { BgSettings, simpleHash, fetchImageBytes, decodeJpegBytes, processBackground, extractAccent } from "./image-processing.ts";

// Upload image bytes to storage and return public URL
export async function uploadBackground(
  supabase: any,
  bytes: Uint8Array,
  fileName: string,
): Promise<string | null> {
  try {
    const uploadedAt = Date.now();

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

    // Cache-buster = tiden vi själva laddade upp (ingen list-rundtur)
    return `${urlData.publicUrl}?v=${uploadedAt}`;
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

// Cleanup: keep only bridge files + explicitly referenced URLs (current + next background).
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

    if (!files) return;

    // Keep only the current and next background — no cache of older covers.
    // Files younger than 60s are spared (an in-flight prefetch may not be referenced yet).
    const now = Date.now();
    const toDelete = files
      .filter((f: any) => !keepNames.has(f.name))
      .filter((f: any) => now - new Date(f.updated_at || f.created_at).getTime() > 60_000)
      .map((f: any) => f.name);

    if (toDelete.length > 0) {
      await supabase.storage.from('sonos-backgrounds').remove(toDelete);
      console.log(`[SonosSync] cleanup: deleted ${toDelete.length} background(s), total was ${files.length}`);
    }
  } catch {
    // Non-critical, ignore
  }
}

// Resolve background image with cache support
export async function resolveBackground(
  supabase: any,
  art: string | Uint8Array | null,
  trackId: string,
  settings: BgSettings,
  targetW: number,
  targetH: number,
  _forceRegenerate?: boolean,
  trackName?: string | null,
): Promise<{ bgUrl: string | null, cached: boolean, generationMs: number, accentColor: string | null }> {
  if (!art) return { bgUrl: null, cached: false, generationMs: 0, accentColor: null };

  const t0 = Date.now();
  const trackHash = simpleHash(trackId);
  const settingsHash = simpleHash(`${settings.blur}-${settings.brightness}-${settings.contrast}-${settings.saturation}-${settings.vignette}-${settings.topGradientOpacity}-${settings.topGradientHeight}`);
  const namePart = trackName
    ? '-' + trackName.toLowerCase()
        .replace(/å/g, 'a').replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u')
        .replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
    : '';
  const bgFileName = `${trackHash}${namePart}-${settingsHash}-${targetW}x${targetH}-v9.jpg`;

  const bytes = typeof art === 'string' ? await fetchImageBytes(art) : art;
  const decoded = bytes ? await decodeJpegBytes(bytes) : null;
  const accentColor = decoded ? extractAccent(decoded.data, decoded.width, decoded.height) : null;

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
      return { bgUrl: `${urlData.publicUrl}?v=${ts}`, cached: true, generationMs: elapsed, accentColor };
    }
  }

  // Cache miss — fetch, process, upload
  // Bytes från bryggan används direkt — ingen nedladdning av filen vi just laddat upp
  if (!decoded) return { bgUrl: null, cached: false, generationMs: Date.now() - t0, accentColor: null };

  console.log(`[SonosSync] Generating BG: ${bgFileName}`);
  const bgBytes = await processBackground(decoded.data, decoded.width, decoded.height, targetW, targetH, settings);

  const bgUrl = await uploadBackground(supabase, bgBytes, bgFileName);
  const elapsed = Date.now() - t0;
  console.log(`[SonosSync] Generated BG in ${elapsed}ms: ${bgFileName}`);

  return { bgUrl, cached: false, generationMs: elapsed, accentColor };
}
