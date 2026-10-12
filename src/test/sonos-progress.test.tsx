import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRef, useState } from 'react';
import { useSonosRealtime } from '@/components/sonos/hooks/useSonosRealtime';
import { useSonosPlaybackTicker } from '@/components/sonos/hooks/useSonosPlaybackTicker';
import type { NowPlaying } from '@/components/sonos/hooks/types';

const rt = vi.hoisted(() => ({ handler: undefined as undefined | ((payload: unknown) => void) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  channel: () => ({ on: (_event: string, _filter: unknown, handler: typeof rt.handler) => {
    rt.handler = handler;
    return { subscribe: () => ({}) };
  } }),
  removeChannel: vi.fn(),
} }));
vi.mock('@/lib/tv-debug-log', () => ({ tvDebug: vi.fn() }));

const track: NowPlaying = {
  track_name: 'New track', artist_name: 'Artist', album_art_url: null,
  playback_state: 'PLAYBACK_STATE_PLAYING', position_ms: 20000, duration_ms: 240000, track_seq: 1,
};

function useHarness(initial: NowPlaying | null, ticker = false) {
  const [nowPlaying, setNowPlaying] = useState(initial);
  const nowPlayingRef = useRef(nowPlaying);
  nowPlayingRef.current = nowPlaying;
  const localProgressRef = useRef<number | null>(null);
  const progressBarRef = useRef(document.createElement('div'));
  const debugTimeRef = useRef(document.createElement('span'));
  const bgSentRef = useRef<string | null>('existing');
  const validBgBufferRef = useRef<string[]>([]);
  const onAlbumArtChangeRef = useRef(undefined);
  const acceptedSeqRef = useRef(1);
  const swappedFromRef = useRef<{ trackName: string; ts: number } | null>(null);
  const shared = { nowPlayingRef, localProgressRef, progressBarRef, debugTimeRef, bgSentRef,
    validBgBufferRef, onAlbumArtChangeRef, acceptedSeqRef, swappedFromRef };
  useSonosRealtime({ ...shared, isConnected: true, showWidget: true, setNowPlaying });
  useSonosPlaybackTicker({ ...shared, nowPlaying: ticker ? nowPlaying : null,
    handleTrackChange: vi.fn(), lastPredictivePollRef: useRef(0), predictiveScheduledRef: useRef(false) });
  return { nowPlaying, localProgressRef, progressBarRef };
}

afterEach(() => vi.useRealTimers());

describe('Sonos progress', () => {
  it('corrects duration and position when realtime confirms a predicted track', () => {
    const { result } = renderHook(() => useHarness({ ...track, duration_ms: 120000 }));
    act(() => rt.handler?.({ new: track }));
    expect(result.current.nowPlaying?.duration_ms).toBe(240000);
    expect(result.current.localProgressRef.current).toBe(20000);
    expect(result.current.progressBarRef.current.style.transform).toBe(`scaleX(${20000 / 240000})`);
  });

  it.each([null, { ...track, playback_state: 'PLAYBACK_STATE_IDLE' }])('seeds first state or wake position independently of the updater', initial => {
    const { result } = renderHook(() => useHarness(initial));
    act(() => rt.handler?.({ new: track }));
    expect(result.current.localProgressRef.current).toBe(20000);
    expect(result.current.nowPlaying?.track_name).toBe('New track');
  });

  it('seeds a missing ticker position from the current track and advances it', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useHarness(track, true));
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.localProgressRef.current).toBe(21000);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.localProgressRef.current).toBe(22000);
  });
});
