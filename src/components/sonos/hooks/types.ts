export interface NowPlaying {
  track_name: string | null;
  artist_name: string | null;
  album_name?: string | null;
  album_art_url: string | null;
  bg_image_url?: string | null;
  widget_art_url?: string | null;
  next_track_name?: string | null;
  next_artist_name?: string | null;
  next_widget_art_url?: string | null;
  next_bg_image_url?: string | null;
  next_album_art_url?: string | null;
  track_seq?: number;
  duration_ms: number | null;
  position_ms: number | null;
  playback_state: string;
}


export type ArtStatus = 'displayed' | 'detecting' | 'loading';

/** Monotonic seq gate: check if incoming seq is stale */
export function isSeqStale(acceptedSeq: number, incomingSeq: number | undefined): boolean {
  if (typeof incomingSeq !== 'number') return false; // no seq → allow (legacy)
  return incomingSeq < acceptedSeq;
}

export const PLAYBACK_POLL_INTERVAL = 5000;
export const PLAYBACK_POLL_TIMEOUT = 12000;
export const PREDICTIVE_THRESHOLD_MS = 10000;
export const PREDICTIVE_MARGIN_MS = 500;
export const PREDICTIVE_RETRY_INTERVAL_MS = 2000;
export const PREDICTIVE_MAX_RETRIES = 15;
export const PREDICTIVE_COOLDOWN_MS = 3000;


export function stripQuery(url: string): string {
  return url.split('?')[0];
}

/** Extract filename from storage URL for debug display */
export function extractFileName(url: string | null | undefined): string {
  if (!url) return '?';
  const path = url.split('?')[0];
  const parts = path.split('/');
  return parts[parts.length - 1] || '?';
}

export function pushToBgBuffer(buf: string[], url: string | null | undefined): void {
  if (!url) return;
  const stripped = stripQuery(url);
  if (buf.some(u => stripQuery(u) === stripped)) return;
  buf.push(url);
  if (buf.length > 6) buf.shift();
}

export async function triggerServerSync(): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-sonos-now-playing`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
  } catch { /* ignore */ } finally { clearTimeout(timeout); }
}

export async function fetchPlaybackStatus(): Promise<{
  bgImageUrl?: string; widgetArtUrl?: string; albumArtUrl?: string;
  trackName?: string; artistName?: string; albumName?: string;
  playbackState?: string; positionMillis?: number; durationMillis?: number;
} | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PLAYBACK_POLL_TIMEOUT);
  try {
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sonos-playback-status`,
      {
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    return data.ok ? data : null;
  } catch { return null; } finally { clearTimeout(timeout); }
}

/**
 * Fetch processed image URLs directly from the DB (sonos_now_playing row).
 * Used after triggerServerSync to get bg/widget images without waiting for realtime.
 */
export async function fetchNowPlayingImages(): Promise<{
  bgImageUrl?: string; widgetArtUrl?: string; albumArtUrl?: string;
  trackName?: string;
} | null> {
  try {
    const { supabase } = await import('@/integrations/supabase/client');
    const { data } = await supabase
      .from('sonos_now_playing')
      .select('bg_image_url, widget_art_url, album_art_url, track_name')
      .limit(1)
      .single();
    if (!data) return null;
    return {
      bgImageUrl: data.bg_image_url ?? undefined,
      widgetArtUrl: data.widget_art_url ?? undefined,
      albumArtUrl: data.album_art_url ?? undefined,
      trackName: data.track_name ?? undefined,
    };
  } catch { return null; }
}

export function updateProgressDOM(
  progressBarRef: { current: HTMLDivElement | null },
  debugTimeRef: { current: HTMLSpanElement | null },
  position: number,
  duration: number | null,
): void {
  if (!duration) return;
  const pct = Math.min((position / duration) * 100, 100);
  if (progressBarRef.current) progressBarRef.current.style.width = `${pct}%`;
  if (debugTimeRef.current) {
    const remaining = Math.max(0, Math.round((duration - position) / 1000));
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    debugTimeRef.current.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
  }
}
