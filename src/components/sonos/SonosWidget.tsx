import { memo, useState, useRef, useCallback, useEffect } from "react";
import { NowPlaying, PrefetchStatus, ArtStatus, pushToBgBuffer, stripQuery } from "./hooks/types";
import {
  useSonosInit, useSonosTrackChange, useSonosPlaybackTicker,
  useSonosClientPolling, useSonosVisibility, useSonosRealtime,
} from "./hooks";

interface SonosDebugInfo {
  currentArtStatus: ArtStatus;
  prefetchStatus: PrefetchStatus;
  trackName: string | null;
  artistName: string | null;
  playbackState: string | null;
  displayedArtUrl: string | null;
  incomingArtUrl: string | null;
  isNewArtPending: boolean;
  bgSent: string | null;
  bgBufferLen: number;
  imageError: boolean;
  nextWidgetArt: string | null;
  nextBgUrl: string | null;
}

interface DebugLogEntry {
  time: string;
  event: string;
}

interface SonosWidgetProps {
  isMobile?: boolean;
  isTvMode?: boolean;
  onAlbumArtChange?: (url: string | null) => void;
  showDebug?: boolean;
  onRealtimeRef?: React.MutableRefObject<((payload: any) => void) | null>;
  onDebugInfo?: React.MutableRefObject<SonosDebugInfo | null>;
}

function formatTime(): string {
  const d = new Date();
  return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}.${d.getMilliseconds().toString().padStart(3,'0')}`;
}

export const SonosWidget = memo(function SonosWidget({
  isMobile = false,
  isTvMode = false,
  onAlbumArtChange,
  showDebug = false,
  onRealtimeRef,
  onDebugInfo,
}: SonosWidgetProps) {
  // --- State ---
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [displayedArtUrl, setDisplayedArtUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const [prefetchStatus, setPrefetchStatus] = useState<PrefetchStatus>("idle");
  const prefetchStatusRef = useRef<PrefetchStatus>("idle");
  const setPrefetchStatusTracked = useCallback((status: PrefetchStatus) => {
    prefetchStatusRef.current = status;
    setPrefetchStatus(status);
  }, []);
  const [currentArtStatus, setCurrentArtStatus] = useState<ArtStatus>("displayed");

  // --- Debug timeline log ---
  const [debugLog, setDebugLog] = useState<DebugLogEntry[]>([]);
  const addDebugLog = useCallback((event: string) => {
    setDebugLog(prev => {
      const entry = { time: formatTime(), event };
      const next = [...prev, entry];
      return next.length > 15 ? next.slice(-15) : next;
    });
  }, []);

  // --- DOM refs for zero-rerender progress updates ---
  const progressBarRef = useRef<HTMLDivElement>(null);
  const debugTimeRef = useRef<HTMLSpanElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // --- Shared mutable refs ---
  const localProgressRef = useRef<number | null>(null);
  const trackChangedAtRef = useRef<number>(0);
  const earlySwapDoneRef = useRef(false);
  const bgSentRef = useRef<string | null>(null);
  const validBgBufferRef = useRef<string[]>([]);
  const onAlbumArtChangeRef = useRef(onAlbumArtChange);
  onAlbumArtChangeRef.current = onAlbumArtChange;
  const lastPredictivePollRef = useRef<number>(0);
  const predictiveScheduledRef = useRef(false);
  const prefetchTriggeredForTrackRef = useRef<string | null>(null);
  const trackChangeOffsetRef = useRef<number>(0);
  const prefetchSecondsRef = useRef<number>(30);
  const nowPlayingRef = useRef<NowPlaying | null>(null);
  nowPlayingRef.current = nowPlaying;

  // --- Hooks ---
  const { isConnected, showWidget } = useSonosInit({
    setNowPlaying, localProgressRef, trackChangeOffsetRef, prefetchSecondsRef,
  });

  const { handleTrackChange } = useSonosTrackChange({
    setNowPlaying, setCurrentArtStatus,
    localProgressRef, trackChangedAtRef,
    bgSentRef, validBgBufferRef, onAlbumArtChangeRef,
    progressBarRef, debugTimeRef,
  });

  useSonosPlaybackTicker({
    nowPlaying, nowPlayingRef, setNowPlaying, setPrefetchStatus: setPrefetchStatusTracked, handleTrackChange,
    localProgressRef, trackChangedAtRef, earlySwapDoneRef,
    lastPredictivePollRef, predictiveScheduledRef, prefetchTriggeredForTrackRef,
    trackChangeOffsetRef, prefetchSecondsRef, bgSentRef, validBgBufferRef, onAlbumArtChangeRef,
    progressBarRef, debugTimeRef, addDebugLog,
  });

  useSonosClientPolling({
    isConnected, showWidget, nowPlaying, nowPlayingRef, displayedArtUrl,
    setNowPlaying, handleTrackChange,
    localProgressRef, lastPredictivePollRef, trackChangedAtRef, trackChangeOffsetRef,
    bgSentRef, validBgBufferRef, onAlbumArtChangeRef,
    progressBarRef, debugTimeRef,
  });

  useSonosRealtime({
    onRealtimeRef, isConnected, showWidget, setNowPlaying,
    localProgressRef, trackChangedAtRef,
    bgSentRef, validBgBufferRef, onAlbumArtChangeRef,
    progressBarRef, debugTimeRef,
  });

  const { shouldHide } = useSonosVisibility({
    isConnected, showWidget, nowPlaying, setNowPlaying,
    onAlbumArtChangeRef, bgSentRef, validBgBufferRef,
  });

  // --- Image preloading ---
  // Prefer server-generated widget thumbnail over raw Spotify URL
  const incomingArtUrl = nowPlaying?.widget_art_url ?? nowPlaying?.album_art_url ?? null;

  // Reset imageError when a new art URL arrives so future tracks aren't blocked
  useEffect(() => {
    if (incomingArtUrl) setImageError(false);
  }, [incomingArtUrl]);

  const isNewArtPending = incomingArtUrl && (!displayedArtUrl || stripQuery(incomingArtUrl) !== stripQuery(displayedArtUrl)) && !imageError;

  // Update debug info ref for external panel
  useEffect(() => {
    if (onDebugInfo) {
      onDebugInfo.current = {
        currentArtStatus,
        prefetchStatus,
        trackName: nowPlaying?.track_name ?? null,
        artistName: nowPlaying?.artist_name ?? null,
        playbackState: nowPlaying?.playback_state ?? null,
        displayedArtUrl,
        incomingArtUrl,
        isNewArtPending: !!isNewArtPending,
        bgSent: bgSentRef.current,
        bgBufferLen: validBgBufferRef.current.length,
        imageError,
        nextWidgetArt: nowPlaying?.next_widget_art_url ?? null,
        nextBgUrl: nowPlaying?.next_bg_image_url ?? null,
      };
    }
  });

  // Track art loading status for debug dot
  useEffect(() => {
    if (isNewArtPending && currentArtStatus !== "detecting") {
      console.log('[Sonos:BG] artStatus: loading (new art pending)');
      setCurrentArtStatus("loading");
      addDebugLog(`⏳ New widget art pending (loading)`);
    }
  }, [isNewArtPending, currentArtStatus]);

  // Auto-transition prefetch to "loaded" when no next-track URLs exist
  useEffect(() => {
    if (prefetchStatus === 'ready') {
      const hasNextArt = nowPlaying?.next_widget_art_url || nowPlaying?.next_album_art_url;
      const hasNextBg = nowPlaying?.next_bg_image_url;
      if (!hasNextArt && !hasNextBg) {
        console.log('[Sonos:BG] prefetchStatus: loaded (no next-track URLs to preload)');
        setPrefetchStatusTracked('loaded');
        addDebugLog(`✅ Prefetch: loaded (no next URLs)`);
      }
    }
  }, [prefetchStatus, nowPlaying?.next_widget_art_url, nowPlaying?.next_album_art_url, nowPlaying?.next_bg_image_url]);

  // (Prefetch status changes are now logged from the ticker hook)

  const handleNewImageLoaded = useCallback(() => {
    const bgUrl = nowPlaying?.bg_image_url || incomingArtUrl;
    console.log('[Sonos:BG] handleNewImageLoaded', {
      incomingArtUrl: incomingArtUrl?.slice(-60),
      displayedArtUrl: displayedArtUrl?.slice(-60),
      bgUrl: bgUrl?.slice(-60),
      bgSent: bgSentRef.current?.slice(-60),
      bufferLen: validBgBufferRef.current.length,
      inBuffer: bgUrl ? validBgBufferRef.current.some(u => u === bgUrl) : false,
    });
    addDebugLog(`🖼️ Widget art loaded in browser`);
    setDisplayedArtUrl(incomingArtUrl);
    setImageError(false);
    console.log('[Sonos:BG] artStatus: displayed (image loaded)');
    setCurrentArtStatus("displayed");
    // Always send bg to dashboard when it differs from last sent
    const newBgStripped = bgUrl ? stripQuery(bgUrl) : null;
    const sentStripped = bgSentRef.current ? stripQuery(bgSentRef.current) : null;
    if (bgUrl && newBgStripped !== sentStripped) {
      console.log('[Sonos:BG] Sending bg to dashboard:', bgUrl?.slice(-60));
      pushToBgBuffer(validBgBufferRef.current, bgUrl);
      onAlbumArtChangeRef.current?.(bgUrl);
      bgSentRef.current = bgUrl;
      addDebugLog(`🎨 BG sent to dashboard`);
    } else if (bgUrl && !bgSentRef.current) {
      console.log('[Sonos:BG] Sending initial bg to dashboard:', bgUrl?.slice(-60));
      pushToBgBuffer(validBgBufferRef.current, bgUrl);
      onAlbumArtChangeRef.current?.(bgUrl);
      bgSentRef.current = bgUrl;
      addDebugLog(`🎨 BG sent to dashboard (initial)`);
    } else {
      addDebugLog(`⚠️ BG skipped (same as sent)`);
    }
  }, [incomingArtUrl, nowPlaying?.bg_image_url]);

  // Log track changes
  useEffect(() => {
    if (nowPlaying?.track_name) {
      addDebugLog(`🎵 Track: ${nowPlaying.track_name}`);
    }
  }, [nowPlaying?.track_name]);

  // --- Render ---
  if (shouldHide || !nowPlaying) return null;

  const trackFontSize = isMobile ? "0.8rem" : "18px";
  const artistFontSize = isMobile ? "0.7rem" : "14px";
  const progressHeight = isMobile ? "2px" : "5px";
  const widgetHeight = isMobile ? "56px" : "130px";
  const widgetWidth = isMobile ? "140px" : "280px";
  const hasAlbumArt = !!displayedArtUrl;

  return (
    <>
      <div
        className="relative overflow-hidden rounded-xl"
        style={{
          width: widgetWidth,
          height: widgetHeight,
          contain: "strict",
          boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 20px 50px -10px rgba(0, 0, 0, 0.25)",
          border: "1px solid rgba(255, 255, 255, 0.15)",
        }}
      >
        {/* Fallback gradient background */}
        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(135deg, hsl(var(--primary) / 0.9) 0%, hsl(var(--primary) / 0.7) 100%)" }}
        />

        {/* Displayed album art */}
        {displayedArtUrl && (
          <img src={displayedArtUrl} alt="" decoding="async" className="absolute inset-0 w-full h-full object-cover" />
        )}

        {/* Preloader for new art (hidden until loaded) */}
        {isNewArtPending && (
          <img
            src={incomingArtUrl!}
            alt=""
            decoding="async"
            className="absolute inset-0 w-full h-full object-cover"
            style={{ opacity: 0, pointerEvents: "none" }}
            onLoad={handleNewImageLoaded}
            onError={() => { setImageError(true); addDebugLog(`❌ Widget art load error`); }}
          />
        )}

        {/* Preload next track's album art (prefer widget thumbnail) */}
        {(nowPlaying.next_widget_art_url || nowPlaying.next_album_art_url) && (nowPlaying.next_widget_art_url || nowPlaying.next_album_art_url) !== displayedArtUrl && (nowPlaying.next_widget_art_url || nowPlaying.next_album_art_url) !== incomingArtUrl && (
          <img
            src={nowPlaying.next_widget_art_url || nowPlaying.next_album_art_url!}
            alt=""
            decoding="async"
            onLoad={() => { if (prefetchStatusRef.current !== "idle") { setPrefetchStatusTracked("loaded"); addDebugLog(`✅ Next art preloaded`); } }}
            style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
          />
        )}

        {/* Preload next track's background */}
        {nowPlaying.next_bg_image_url && (
          <img
            src={nowPlaying.next_bg_image_url}
            alt=""
            decoding="async"
            onLoad={() => { if (prefetchStatusRef.current !== "idle") { setPrefetchStatusTracked("loaded"); addDebugLog(`✅ Next BG preloaded`); } }}
            style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
          />
        )}

        {/* Dark overlay for readability */}
        {hasAlbumArt && (
          <div
            className="absolute inset-0"
            style={{ background: "linear-gradient(135deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.3) 100%)" }}
          />
        )}

        {/* Content */}
        <div className={`relative h-full flex flex-col justify-center ${isMobile ? "px-3 py-2" : "px-5 py-3"}`}>
          <div ref={containerRef} className="overflow-hidden">
            <div className="whitespace-nowrap font-semibold text-white drop-shadow-lg" style={{ fontSize: trackFontSize }}>
              {nowPlaying.track_name}
            </div>
          </div>
          {nowPlaying.artist_name && (
            <div className="truncate text-white/80 drop-shadow-md" style={{ fontSize: artistFontSize }}>
              {nowPlaying.artist_name}
            </div>
          )}

          {/* Progress Bar — updated via DOM ref, zero re-renders */}
          {nowPlaying.duration_ms && (
            <div
              className="w-full rounded-full overflow-hidden mt-3"
              style={{ height: progressHeight, background: "rgba(255, 255, 255, 0.2)" }}
            >
              <div
                ref={progressBarRef}
                className="h-full rounded-full"
                style={{ width: "0%", background: "rgba(255, 255, 255, 0.9)" }}
              />
            </div>
          )}

          {/* Prefetch status indicator */}
          <div className="absolute top-1 right-1 flex items-center gap-1">
            {nowPlaying.duration_ms && (
              <span ref={debugTimeRef} className="text-white/70 font-mono" style={{ fontSize: "10px", lineHeight: 1 }}>
                0:00
              </span>
            )}
            {prefetchStatus !== "idle" && (
              <div
                title={`Prefetch: ${prefetchStatus}`}
                className="rounded-full"
                style={{
                  width: 8, height: 8,
                  background: prefetchStatus === "fetching" ? "#ef4444" : prefetchStatus === "ready" ? "#eab308" : "#22c55e",
                  boxShadow: `0 0 4px ${prefetchStatus === "fetching" ? "#ef4444" : prefetchStatus === "ready" ? "#eab308" : "#22c55e"}`,
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Debug timeline log */}
      {debugLog.length > 0 && (
        <div
          className="mt-2 rounded-lg overflow-hidden font-mono"
          style={{
            width: isMobile ? "140px" : "280px",
            maxHeight: "200px",
            overflowY: "auto",
            background: "rgba(0,0,0,0.7)",
            border: "1px solid rgba(255,255,255,0.1)",
            fontSize: "9px",
            lineHeight: "1.4",
          }}
        >
          {debugLog.map((entry, i) => (
            <div key={i} className="px-2 py-0.5 text-white/80" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <span className="text-white/40">{entry.time}</span>{" "}
              {entry.event}
            </div>
          ))}
        </div>
      )}
    </>
  );
});

export type { SonosDebugInfo };
