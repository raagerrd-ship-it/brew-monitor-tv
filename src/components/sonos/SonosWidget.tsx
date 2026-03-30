import { memo, useState, useRef, useCallback, useEffect, useMemo } from "react";
import { NowPlaying, stripQuery, pushToBgBuffer } from "./hooks/types";
import {
  useSonosInit, useSonosTrackChange, useSonosPlaybackTicker,
  useSonosClientPolling, useSonosVisibility, useSonosRealtime,
} from "./hooks";
import { Logo } from "../Logo";
import { useAlbumArt } from "@/contexts/AlbumArtContext";


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
  const bgSentRef = useRef<string | null>(null);
  const validBgBufferRef = useRef<string[]>([]);
  const onAlbumArtChangeRef = useRef(onAlbumArtChange);
  onAlbumArtChangeRef.current = onAlbumArtChange;
  const lastPredictivePollRef = useRef<number>(0);
  const predictiveScheduledRef = useRef(false);
  const acceptedSeqRef = useRef<number>(0);
  const swappedFromRef = useRef<{ trackName: string; ts: number } | null>(null);
  
  const nowPlayingRef = useRef<NowPlaying | null>(null);
  nowPlayingRef.current = nowPlaying;

  const { isConnected, showWidget, trackChangeOffsetMs } = useSonosInit({
    setNowPlaying, localProgressRef, acceptedSeqRef,
  });

  const { handleTrackChange } = useSonosTrackChange({
    setNowPlaying, localProgressRef,
    bgSentRef, validBgBufferRef, onAlbumArtChangeRef,
    progressBarRef, debugTimeRef, trackNameRef, artistNameRef,
  });

  useSonosPlaybackTicker({
    nowPlaying, nowPlayingRef, handleTrackChange,
    localProgressRef,
    lastPredictivePollRef, predictiveScheduledRef,
    bgSentRef, validBgBufferRef, onAlbumArtChangeRef,
    progressBarRef, debugTimeRef,
    trackChangeOffsetMs,
    acceptedSeqRef,
    swappedFromRef,
  });

  useSonosClientPolling({
    isConnected, showWidget, nowPlaying, nowPlayingRef,
    setNowPlaying, handleTrackChange,
    localProgressRef, lastPredictivePollRef,
    progressBarRef, debugTimeRef,
    acceptedSeqRef,
  });

  useSonosRealtime({
    isConnected, showWidget, setNowPlaying,
    localProgressRef,
    bgSentRef, validBgBufferRef, onAlbumArtChangeRef,
    progressBarRef, debugTimeRef,
    acceptedSeqRef,
    swappedFromRef,
  });

  // Send bg image on init when nowPlaying arrives with bg_image_url
  useEffect(() => {
    if (nowPlaying?.bg_image_url && !bgSentRef.current) {
      onAlbumArtChangeRef.current?.(nowPlaying.bg_image_url, nowPlaying.track_name ?? undefined);
      bgSentRef.current = nowPlaying.bg_image_url;
      pushToBgBuffer(validBgBufferRef.current, nowPlaying.bg_image_url);
    }
  }, [nowPlaying?.bg_image_url]);

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

  const needsDirectApply = incomingArtUrl && !displayedArtUrl && !imageError;
  const isNewArtPending = incomingArtUrl && displayedArtUrl && stripQuery(incomingArtUrl) !== stripQuery(displayedArtUrl) && !imageError;

  useEffect(() => {
    if (needsDirectApply && incomingArtUrl) {
      setDisplayedArtUrl(incomingArtUrl);
    }
  }, [needsDirectApply, incomingArtUrl]);

  const handleNewImageLoaded = useCallback(() => {
    setDisplayedArtUrl(incomingArtUrl);
    setImageError(false);
  }, [incomingArtUrl]);

  if (isHidden) return variant === "header" ? <Logo /> : null;

  const isHeader = variant === "header";

  // Header variant: transparent item matching RAPT controller-bar style
  if (isHeader) {
    const progress = nowPlaying.duration_ms
      ? Math.min(100, ((localProgressRef.current ?? nowPlaying.position_ms ?? 0) / nowPlaying.duration_ms) * 100)
      : 0;

    return (
      <div
        className="relative flex items-center justify-center rounded px-3 gap-2 flex-shrink-0"
        style={{ background: 'transparent', width: '350px', paddingTop: '4px', paddingBottom: nowPlaying.duration_ms ? '10px' : '4px' }}
        onMouseEnter={e => { e.currentTarget.style.background = 'hsl(222 18% 15%)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
      >
        <div className="truncate text-white" style={{ fontSize: '16px' }}>
          {nowPlaying.artist_name && <span ref={artistNameRef} className="font-semibold">{nowPlaying.artist_name}</span>}
          {nowPlaying.artist_name && nowPlaying.track_name && <span className="text-white/50 font-normal"> — </span>}
          <span ref={trackNameRef} className="text-white/70 font-normal">{nowPlaying.track_name}</span>
        </div>

        {/* Progress bar — battery-bar style */}
        {nowPlaying.duration_ms && (
          <div className="absolute bottom-1 left-1.5 right-1.5 rounded-full overflow-hidden" style={{
            height: '4px',
            background: 'hsl(0 0% 0% / 0.5)',
            boxShadow: 'inset 0 1px 2px hsl(0 0% 0% / 0.6), inset 0 -1px 0 hsl(0 0% 100% / 0.05)',
          }}>
            <div
              ref={progressBarRef}
              className="absolute top-0 bottom-0 left-0 rounded-full transition-all duration-500"
              style={{
                width: `${Math.max(progress, 0.5)}%`,
                background: 'hsl(0 0% 100% / 0.7)',
                boxShadow: '0 0 6px hsl(0 0% 100% / 0.6)',
              }}
            />
            <div
              className="absolute inset-0 rounded-full pointer-events-none"
              style={{ background: 'linear-gradient(180deg, hsl(0 0% 100% / 0.2) 0%, transparent 40%)' }}
            />
          </div>
        )}
        {/* Hidden time ref for ticker updates */}
        <span ref={debugTimeRef} className="sr-only">0:00</span>
      </div>
    );
  }

  // Floating variant (unchanged)
  const trackFontSize = isMobile ? "0.8rem" : "18px";
  const artistFontSize = isMobile ? "0.7rem" : "14px";
  const progressHeight = isMobile ? "2px" : "5px";
  const widgetHeight = isMobile ? "56px" : "130px";
  const widgetWidth = isMobile ? "140px" : "280px";

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
          style={{ background: "linear-gradient(135deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.3) 100%)" }}
        />
      )}

      <div className={`relative h-full flex flex-col justify-center ${isMobile ? "px-3 py-2" : "px-5 py-3"}`}>
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

        {nowPlaying.duration_ms && (
          <div className="flex items-center gap-2 mt-3">
            <div className="flex-1 rounded-full overflow-hidden" style={{ height: progressHeight, background: "rgba(255, 255, 255, 0.2)" }}>
              <div ref={progressBarRef} className="h-full rounded-full" style={{ width: "0%", background: "rgba(255, 255, 255, 0.9)" }} />
            </div>
            <span ref={debugTimeRef} className="text-white/60 font-mono flex-shrink-0" style={{ fontSize: isMobile ? "8px" : "11px", lineHeight: 1 }}>
              0:00
            </span>
          </div>
        )}
      </div>
    </div>
  );
});
