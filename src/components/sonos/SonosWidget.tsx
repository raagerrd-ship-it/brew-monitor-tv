import { memo, useState, useRef, useCallback, useEffect } from "react";
import { NowPlaying, ArtStatus, pushToBgBuffer, stripQuery } from "./hooks/types";
import {
  useSonosInit, useSonosTrackChange, useSonosPlaybackTicker,
  useSonosClientPolling, useSonosVisibility, useSonosRealtime,
} from "./hooks";
import { Logo } from "../Logo";
import { tvDebug } from "@/lib/tv-debug-log";

interface SonosWidgetProps {
  isMobile?: boolean;
  isTvMode?: boolean;
  variant?: "floating" | "header";
  onAlbumArtChange?: (url: string | null, trackName?: string) => void;
  onRealtimeRef?: React.MutableRefObject<((payload: any) => void) | null>;
}

export const SonosWidget = memo(function SonosWidget({
  isMobile = false,
  isTvMode = false,
  variant = "floating",
  onAlbumArtChange,
  onRealtimeRef,
}: SonosWidgetProps) {
  // --- State ---
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [displayedArtUrl, setDisplayedArtUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const [currentArtStatus, setCurrentArtStatus] = useState<ArtStatus>("displayed");

  // --- DOM refs for zero-rerender progress updates ---
  const progressBarRef = useRef<HTMLDivElement>(null);
  const debugTimeRef = useRef<HTMLSpanElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // --- Shared mutable refs ---
  const localProgressRef = useRef<number | null>(null);
  const trackChangedAtRef = useRef<number>(0);
  const bgSentRef = useRef<string | null>(null);
  const validBgBufferRef = useRef<string[]>([]);
  const onAlbumArtChangeRef = useRef(onAlbumArtChange);
  onAlbumArtChangeRef.current = onAlbumArtChange;
  const lastPredictivePollRef = useRef<number>(0);
  const predictiveScheduledRef = useRef(false);
  const trackChangeOffsetRef = useRef<number>(0);
  const nowPlayingRef = useRef<NowPlaying | null>(null);
  nowPlayingRef.current = nowPlaying;

  // No-op debug log (hooks still call it but it does nothing)
  const addDebugLog = useCallback((_event: string) => {}, []);

  // --- Hooks ---
  const { isConnected, showWidget } = useSonosInit({
    setNowPlaying, localProgressRef, trackChangeOffsetRef,
  });

  const { handleTrackChange } = useSonosTrackChange({
    setNowPlaying, setCurrentArtStatus,
    localProgressRef, trackChangedAtRef,
    bgSentRef, validBgBufferRef, onAlbumArtChangeRef,
    progressBarRef, debugTimeRef, addDebugLog,
  });

  useSonosPlaybackTicker({
    nowPlaying, nowPlayingRef, setNowPlaying, handleTrackChange,
    localProgressRef, trackChangedAtRef,
    lastPredictivePollRef, predictiveScheduledRef, trackChangeOffsetRef,
    progressBarRef, debugTimeRef, addDebugLog,
  });

  useSonosClientPolling({
    isConnected, showWidget, nowPlaying, nowPlayingRef,
    setNowPlaying, handleTrackChange,
    localProgressRef, lastPredictivePollRef, trackChangedAtRef,
    progressBarRef, debugTimeRef, addDebugLog,
  });

  useSonosRealtime({
    onRealtimeRef, isConnected, showWidget, setNowPlaying,
    localProgressRef, trackChangedAtRef,
    bgSentRef, validBgBufferRef, onAlbumArtChangeRef,
    progressBarRef, debugTimeRef, addDebugLog, isTvMode,
  });

  const { shouldHide } = useSonosVisibility({
    isConnected, showWidget, nowPlaying, setNowPlaying,
    onAlbumArtChangeRef, bgSentRef, validBgBufferRef,
  });

  // --- Image preloading ---
  const incomingArtUrl = nowPlaying?.widget_art_url ?? nowPlaying?.album_art_url ?? null;

  // Reset imageError when a new art URL arrives
  const imgFlowRef = useRef(0);
  useEffect(() => {
    if (incomingArtUrl) {
      console.log(`[Sonos:IMG] 🖼️ New art URL received: ${incomingArtUrl.slice(-60)}`);
      imgFlowRef.current++;
      tvDebug('sonos', `⏳ Bild-URL mottagen — laddar...`, `img-${imgFlowRef.current}`);
      setImageError(false);
    }
  }, [incomingArtUrl]);

  const isNewArtPending = incomingArtUrl && (!displayedArtUrl || stripQuery(incomingArtUrl) !== stripQuery(displayedArtUrl)) && !imageError;

  // Track art loading status
  useEffect(() => {
    if (isNewArtPending && currentArtStatus !== "detecting") {
      console.log(`[Sonos:IMG] ⏳ Preloading new art: ${incomingArtUrl?.slice(-60)}`);
      setCurrentArtStatus("loading");
    }
  }, [isNewArtPending, currentArtStatus]);


  const handleNewImageLoaded = useCallback(() => {
    console.log(`[Sonos:IMG] ✅ Widget art loaded: ${incomingArtUrl?.slice(-60)}`);
    tvDebug('sonos', `✅ Låtbild laddad — visas i widget`, `img-${imgFlowRef.current}`);
    const bgUrl = nowPlaying?.bg_image_url || incomingArtUrl;
    setDisplayedArtUrl(incomingArtUrl);
    setImageError(false);
    setCurrentArtStatus("displayed");
    const newBgStripped = bgUrl ? stripQuery(bgUrl) : null;
    const sentStripped = bgSentRef.current ? stripQuery(bgSentRef.current) : null;
    if (bgUrl && (newBgStripped !== sentStripped || !bgSentRef.current)) {
      console.log(`[Sonos:IMG] 🖼️ Sending BG to dashboard: ${bgUrl.slice(-60)}`);
      tvDebug('bg', `🖼️ Ny sidbakgrund skickad för "${nowPlaying?.track_name}"`, 'bg-update');
      pushToBgBuffer(validBgBufferRef.current, bgUrl);
      onAlbumArtChangeRef.current?.(bgUrl, nowPlaying?.track_name ?? undefined);
      bgSentRef.current = bgUrl;
    }
  }, [incomingArtUrl, nowPlaying?.bg_image_url]);

  // --- Render ---
  if (shouldHide || !nowPlaying) return variant === "header" ? <Logo /> : null;

  const isHeader = variant === "header";
  const trackFontSize = isHeader ? "18px" : isMobile ? "0.8rem" : "18px";
  const artistFontSize = isHeader ? "18px" : isMobile ? "0.7rem" : "14px";
  const progressHeight = isHeader ? "2px" : isMobile ? "2px" : "5px";
  const widgetHeight = isHeader ? "50px" : isMobile ? "56px" : "130px";
  const widgetWidth = isHeader ? "380px" : isMobile ? "140px" : "280px";
  const hasAlbumArt = !!displayedArtUrl;

  return (
    <div
      className={`relative overflow-hidden ${isHeader ? "rounded-lg" : "rounded-xl"}`}
      style={{
        width: widgetWidth,
        height: widgetHeight,
        contain: "strict",
        boxShadow: isHeader
          ? "0 4px 12px -2px rgba(0, 0, 0, 0.25)"
          : "0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 20px 50px -10px rgba(0, 0, 0, 0.25)",
        border: isHeader
          ? "1px solid rgba(255, 255, 255, 0.1)"
          : "1px solid rgba(255, 255, 255, 0.15)",
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
          onError={() => { console.error(`[Sonos:IMG] ❌ Failed to load art: ${incomingArtUrl?.slice(-60)}`); setImageError(true); }}
        />
      )}

      {/* Dark overlay for readability */}
      {hasAlbumArt && (
        <div
          className="absolute inset-0"
          style={{ background: isHeader
            ? "linear-gradient(135deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.4) 100%)"
            : "linear-gradient(135deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.3) 100%)"
          }}
        />
      )}

      {/* Content */}
      <div className={`relative h-full flex flex-col justify-center ${isHeader ? "px-3 py-1" : isMobile ? "px-3 py-2" : "px-5 py-3"}`}>
        {isHeader ? (
          <div className="truncate text-white" style={{ fontSize: trackFontSize, textShadow: "0 1px 4px rgba(0,0,0,0.8), 0 0 12px rgba(0,0,0,0.6)" }}>
            {nowPlaying.artist_name && (
              <span className="font-semibold">{nowPlaying.artist_name}</span>
            )}
            {nowPlaying.artist_name && nowPlaying.track_name && (
              <span className="text-white/70 font-normal"> — </span>
            )}
            <span className="text-white/70 font-normal">{nowPlaying.track_name}</span>
          </div>
        ) : (
          <>
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
          </>
        )}

        {/* Progress Bar with countdown */}
        {nowPlaying.duration_ms && (
          <div className={`flex items-center gap-2 ${isHeader ? "mt-1" : "mt-3"}`}>
            <div
              className="flex-1 rounded-full overflow-hidden"
              style={{ height: progressHeight, background: "rgba(255, 255, 255, 0.2)" }}
            >
              <div
                ref={progressBarRef}
                className="h-full rounded-full"
                style={{ width: "0%", background: "rgba(255, 255, 255, 0.9)" }}
              />
            </div>
            <span ref={debugTimeRef} className="text-white/60 font-mono flex-shrink-0" style={{ fontSize: isHeader ? "9px" : isMobile ? "8px" : "11px", lineHeight: 1 }}>
              0:00
            </span>
          </div>
        )}
      </div>
    </div>
  );
});
