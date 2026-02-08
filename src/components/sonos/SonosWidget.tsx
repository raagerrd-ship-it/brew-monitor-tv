import { memo, useState, useRef, useCallback, useEffect } from "react";
import { NowPlaying, PrefetchStatus, ArtStatus, pushToBgBuffer } from "./hooks/types";
import {
  useSonosInit, useSonosTrackChange, useSonosPlaybackTicker,
  useSonosClientPolling, useSonosVisibility, useSonosRealtime,
} from "./hooks";

interface SonosWidgetProps {
  isMobile?: boolean;
  isTvMode?: boolean;
  onAlbumArtChange?: (url: string | null) => void;
  showDebug?: boolean;
  onRealtimeRef?: React.MutableRefObject<((payload: any) => void) | null>;
}

export const SonosWidget = memo(function SonosWidget({
  isMobile = false,
  isTvMode = false,
  onAlbumArtChange,
  showDebug = false,
  onRealtimeRef,
}: SonosWidgetProps) {
  // --- State ---
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [displayedArtUrl, setDisplayedArtUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const [prefetchStatus, setPrefetchStatus] = useState<PrefetchStatus>("idle");
  const [currentArtStatus, setCurrentArtStatus] = useState<ArtStatus>("displayed");

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
    progressBarRef, debugTimeRef,
  });

  useSonosPlaybackTicker({
    nowPlaying, nowPlayingRef, setNowPlaying, setPrefetchStatus, handleTrackChange,
    localProgressRef, trackChangedAtRef, earlySwapDoneRef,
    lastPredictivePollRef, predictiveScheduledRef, prefetchTriggeredForTrackRef,
    trackChangeOffsetRef, prefetchSecondsRef, bgSentRef, validBgBufferRef, onAlbumArtChangeRef,
    progressBarRef, debugTimeRef,
  });

  useSonosClientPolling({
    isConnected, showWidget, nowPlaying, nowPlayingRef, displayedArtUrl,
    setNowPlaying, handleTrackChange,
    localProgressRef, lastPredictivePollRef,
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
    isConnected, showWidget, nowPlaying,
    onAlbumArtChangeRef, bgSentRef, validBgBufferRef,
  });

  // --- Image preloading ---
  const incomingArtUrl = nowPlaying?.album_art_url ?? null;

  // Reset imageError when a new art URL arrives so future tracks aren't blocked
  useEffect(() => {
    if (incomingArtUrl) setImageError(false);
  }, [incomingArtUrl]);

  const isNewArtPending = incomingArtUrl && incomingArtUrl !== displayedArtUrl && !imageError;

  // Track art loading status for debug dot
  useEffect(() => {
    if (isNewArtPending && currentArtStatus !== "detecting") {
      setCurrentArtStatus("loading");
    }
  }, [isNewArtPending, currentArtStatus]);

  const handleNewImageLoaded = useCallback(() => {
    setDisplayedArtUrl(incomingArtUrl);
    setImageError(false);
    setCurrentArtStatus("displayed");
    const bgUrl = nowPlaying?.bg_image_url || incomingArtUrl;
    if (!bgSentRef.current || !validBgBufferRef.current.includes(bgSentRef.current) || bgSentRef.current === bgUrl) {
      pushToBgBuffer(validBgBufferRef.current, bgUrl);
      onAlbumArtChangeRef.current?.(bgUrl);
      bgSentRef.current = bgUrl;
    }
  }, [incomingArtUrl, nowPlaying?.bg_image_url]);

  // --- Render ---
  if (shouldHide || !nowPlaying) return null;

  const trackFontSize = isMobile ? "0.8rem" : "18px";
  const artistFontSize = isMobile ? "0.7rem" : "14px";
  const progressHeight = isMobile ? "2px" : "5px";
  const widgetHeight = isMobile ? "56px" : "130px";
  const widgetWidth = isMobile ? "140px" : "280px";
  const hasAlbumArt = !!displayedArtUrl;

  return (
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
          onError={() => setImageError(true)}
        />
      )}

      {/* Preload next track's album art */}
      {nowPlaying.next_album_art_url && nowPlaying.next_album_art_url !== displayedArtUrl && nowPlaying.next_album_art_url !== incomingArtUrl && (
        <img
          src={nowPlaying.next_album_art_url}
          alt=""
          decoding="async"
          onLoad={() => { if (prefetchStatus === "ready") setPrefetchStatus("loaded"); }}
          style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
        />
      )}

      {/* Preload next track's background */}
      {nowPlaying.next_bg_image_url && (
        <img
          src={nowPlaying.next_bg_image_url}
          alt=""
          decoding="async"
          onLoad={() => { if (prefetchStatus === "ready") setPrefetchStatus("loaded"); }}
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

        {/* Debug indicators */}
        {showDebug && (
          <div className="absolute top-1 right-1 flex items-center gap-1">
            {nowPlaying.duration_ms && (
              <span ref={debugTimeRef} className="text-white/70 font-mono" style={{ fontSize: "10px", lineHeight: 1 }}>
                0s
              </span>
            )}
            {displayedArtUrl && (
              <div
                title={`Current: ${currentArtStatus}`}
                className="rounded-full"
                style={{
                  width: 8, height: 8,
                  background: currentArtStatus === "detecting" ? "#ef4444" : currentArtStatus === "loading" ? "#f97316" : "#22c55e",
                  boxShadow: `0 0 4px ${currentArtStatus === "detecting" ? "#ef4444" : currentArtStatus === "loading" ? "#f97316" : "#22c55e"}`,
                }}
              />
            )}
            {prefetchStatus !== "idle" && (
              <div
                title={`Next: ${prefetchStatus}`}
                className="rounded-full"
                style={{
                  width: 8, height: 8,
                  background: prefetchStatus === "fetching" ? "#f97316" : prefetchStatus === "ready" ? "#eab308" : "#22c55e",
                  boxShadow: `0 0 4px ${prefetchStatus === "fetching" ? "#f97316" : prefetchStatus === "ready" ? "#eab308" : "#22c55e"}`,
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
});
