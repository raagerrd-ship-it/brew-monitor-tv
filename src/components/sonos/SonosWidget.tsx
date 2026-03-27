import { memo, useState, useRef, useCallback, useEffect, useMemo } from "react";
import { NowPlaying, stripQuery } from "./hooks/types";
import {
  useSonosInit, useSonosTrackChange, useSonosPlaybackTicker,
  useSonosClientPolling, useSonosVisibility, useSonosRealtime,
} from "./hooks";
import { Logo } from "../Logo";


interface SonosWidgetProps {
  isMobile?: boolean;
  variant?: "floating" | "header";
}

export const SonosWidget = memo(function SonosWidget({
  isMobile = false,
  variant = "floating",
}: SonosWidgetProps) {
  const { handleAlbumArtChange: onAlbumArtChange } = useAlbumArt();
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [displayedArtUrl, setDisplayedArtUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);

  const progressBarRef = useRef<HTMLDivElement>(null);
  const debugTimeRef = useRef<HTMLSpanElement>(null);
  const trackNameRef = useRef<HTMLDivElement>(null);
  const artistNameRef = useRef<HTMLDivElement>(null);
  const localProgressRef = useRef<number | null>(null);
  const trackChangedAtRef = useRef<number>(0);
  const bgSentRef = useRef<string | null>(null);
  const validBgBufferRef = useRef<string[]>([]);
  const onAlbumArtChangeRef = useRef(onAlbumArtChange);
  onAlbumArtChangeRef.current = onAlbumArtChange;
  const lastPredictivePollRef = useRef<number>(0);
  const predictiveScheduledRef = useRef(false);
  
  const nowPlayingRef = useRef<NowPlaying | null>(null);
  nowPlayingRef.current = nowPlaying;

  const { isConnected, showWidget, trackChangeOffsetMs } = useSonosInit({
    setNowPlaying, localProgressRef,
  });

  const { handleTrackChange } = useSonosTrackChange({
    setNowPlaying, localProgressRef, trackChangedAtRef,
    bgSentRef, validBgBufferRef, onAlbumArtChangeRef,
    progressBarRef, debugTimeRef, trackNameRef, artistNameRef,
  });

  useSonosPlaybackTicker({
    nowPlaying, nowPlayingRef, handleTrackChange,
    localProgressRef, trackChangedAtRef,
    lastPredictivePollRef, predictiveScheduledRef,
    bgSentRef, validBgBufferRef, onAlbumArtChangeRef,
    progressBarRef, debugTimeRef,
    trackChangeOffsetMs,
  });

  useSonosClientPolling({
    isConnected, showWidget, nowPlaying, nowPlayingRef,
    setNowPlaying, handleTrackChange,
    localProgressRef, lastPredictivePollRef, trackChangedAtRef,
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

  // Safety net: clear background whenever widget is hidden
  const isHidden = shouldHide || !nowPlaying;
  useEffect(() => {
    if (isHidden) {
      onAlbumArtChangeRef.current?.(null);
      bgSentRef.current = null;
    }
  }, [isHidden]);

  // --- Image preloading ---
  const incomingArtUrl = nowPlaying?.widget_art_url ?? nowPlaying?.album_art_url ?? null;

  useEffect(() => {
    if (incomingArtUrl) setImageError(false);
  }, [incomingArtUrl]);

  const isNewArtPending = incomingArtUrl && (!displayedArtUrl || stripQuery(incomingArtUrl) !== stripQuery(displayedArtUrl)) && !imageError;

  const handleNewImageLoaded = useCallback(() => {
    setDisplayedArtUrl(incomingArtUrl);
    setImageError(false);
  }, [incomingArtUrl]);

  if (isHidden) return variant === "header" ? <Logo /> : null;

  const isHeader = variant === "header";
  const trackFontSize = isHeader ? "18px" : isMobile ? "0.8rem" : "18px";
  const artistFontSize = isHeader ? "18px" : isMobile ? "0.7rem" : "14px";
  const progressHeight = isHeader ? "2px" : isMobile ? "2px" : "5px";
  const widgetHeight = isHeader ? "50px" : isMobile ? "56px" : "130px";
  const widgetWidth = isHeader ? "380px" : isMobile ? "140px" : "280px";

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
      <div
        className="absolute inset-0"
        style={{ background: "linear-gradient(135deg, hsl(var(--primary) / 0.9) 0%, hsl(var(--primary) / 0.7) 100%)" }}
      />

      {displayedArtUrl && (
        <img src={displayedArtUrl} alt="" decoding="async" className="absolute inset-0 w-full h-full object-cover" />
      )}

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

      {displayedArtUrl && (
        <div
          className="absolute inset-0"
          style={{ background: isHeader
            ? "linear-gradient(135deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.4) 100%)"
            : "linear-gradient(135deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.3) 100%)"
          }}
        />
      )}

      <div className={`relative h-full flex flex-col justify-center ${isHeader ? "px-3 py-1" : isMobile ? "px-3 py-2" : "px-5 py-3"}`}>
        {isHeader ? (
          <div className="truncate text-white" style={{ fontSize: trackFontSize, textShadow: "0 1px 4px rgba(0,0,0,0.8), 0 0 12px rgba(0,0,0,0.6)" }}>
            {nowPlaying.artist_name && <span ref={artistNameRef} className="font-semibold">{nowPlaying.artist_name}</span>}
            {nowPlaying.artist_name && nowPlaying.track_name && <span className="text-white/70 font-normal"> — </span>}
            <span ref={trackNameRef} className="text-white/70 font-normal">{nowPlaying.track_name}</span>
          </div>
        ) : (
          <>
            <div className="overflow-hidden">
              <div ref={trackNameRef} className="whitespace-nowrap font-semibold text-white drop-shadow-lg" style={{ fontSize: trackFontSize }}>
                {nowPlaying.track_name}
              </div>
            </div>
            {nowPlaying.artist_name && (
              <div ref={artistNameRef} className="truncate text-white/80 drop-shadow-md" style={{ fontSize: artistFontSize }}>
                {nowPlaying.artist_name}
              </div>
            )}
          </>
        )}

        {nowPlaying.duration_ms && (
          <div className={`flex items-center gap-2 ${isHeader ? "mt-1" : "mt-3"}`}>
            <div className="flex-1 rounded-full overflow-hidden" style={{ height: progressHeight, background: "rgba(255, 255, 255, 0.2)" }}>
              <div ref={progressBarRef} className="h-full rounded-full" style={{ width: "0%", background: "rgba(255, 255, 255, 0.9)" }} />
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
