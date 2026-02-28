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
  duration_ms: number | null;
  position_ms: number | null;
  playback_state: string;
}


export type ArtStatus = 'displayed' | 'detecting' | 'loading';

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
