import { memo, useState, useRef, useCallback, useEffect, useMemo, useLayoutEffect } from "react";
import { NowPlaying, stripQuery, pushToBgBuffer } from "./hooks/types";
import {
  useSonosInit, useSonosTrackChange, useSonosPlaybackTicker,
  useSonosClientPolling, useSonosVisibility, useSonosRealtime,
} from "./hooks";
import { useAlbumArt } from "@/contexts/AlbumArtContext";


/** Scrolls children horizontally when they overflow, then scrolls back */
function MarqueeText({ children }: { children: React.ReactNode }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(0);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const diff = inner.scrollWidth - outer.clientWidth;
    setOverflow(diff > 2 ? diff : 0);
  }, [children]);

  return (
    <div ref={outerRef} className="overflow-hidden text-foreground" style={{ fontSize: '14px' }}>
      <div
        ref={innerRef}
        className="whitespace-nowrap inline-block"
        style={overflow > 0 ? {
          animation: `marquee-scroll ${8 + overflow * 0.05}s linear 3s infinite`,
          '--marquee-offset': `-${overflow}px`,
        } as React.CSSProperties : undefined}
      >
        {children}
      </div>
    </div>
  );
}

interface SonosWidgetProps {
  isMobile?: boolean;
  variant?: "floating" | "header";
  onVisibilityChange?: (visible: boolean) => void;
}

export const SonosWidget = memo(function SonosWidget({
  isMobile = false,
  variant = "floating",
  onVisibilityChange,
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
    swappedFromRef,
  });

  useSonosRealtime({
    isConnected, showWidget, setNowPlaying,
    localProgressRef,
    bgSentRef, validBgBufferRef, onAlbumArtChangeRef,
    progressBarRef, debugTimeRef,
    acceptedSeqRef,
    swappedFromRef,
  });

  const { shouldHide } = useSonosVisibility({
    isConnected, showWidget, nowPlaying,
    onAlbumArtChangeRef, bgSentRef, validBgBufferRef,
  });

  // Report visibility to parent so the header can resize chips around us.
  useEffect(() => {
    onVisibilityChange?.(!shouldHide && !!nowPlaying);
  }, [shouldHide, nowPlaying, onVisibilityChange]);

  // Send bg image on init when nowPlaying arrives with bg_image_url,
  // but never re-activate background while the widget is intentionally hidden.
  useEffect(() => {
    if (!shouldHide && nowPlaying?.bg_image_url && !bgSentRef.current) {
      onAlbumArtChangeRef.current?.(nowPlaying.bg_image_url, nowPlaying.track_name ?? undefined);
      bgSentRef.current = nowPlaying.bg_image_url;
      pushToBgBuffer(validBgBufferRef.current, nowPlaying.bg_image_url);
    }
  }, [nowPlaying?.bg_image_url, nowPlaying?.track_name, shouldHide]);

  // Safety net: clear background whenever widget is hidden
  const isHidden = shouldHide || !nowPlaying;
  useEffect(() => {
    if (isHidden) {
      onAlbumArtChangeRef.current?.(null);
      bgSentRef.current = null;
      validBgBufferRef.current = [];
    }
  }, [isHidden]);

  // --- Image preloading ---
  const incomingArtUrl = nowPlaying?.album_art_url ?? null;

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

  const isHeader = variant === "header";

  if (isHidden) return null;

    // Header variant: integrated segment in the unified control strip
  if (isHeader) {
    const progress = nowPlaying.duration_ms
      ? Math.min(100, ((localProgressRef.current ?? nowPlaying.position_ms ?? 0) / nowPlaying.duration_ms) * 100)
      : 0;

    return (
      <div
        className="relative flex min-w-0 flex-1 flex-col justify-center bg-transparent"
        style={{ padding: '5px 18px 9px' }}
      >
        {/* Label row — exact copy of controller label row */}
        <div className="flex items-center justify-between gap-1">
          <span className="uppercase font-bold truncate" style={{
            fontSize: '10px',
            letterSpacing: '0.1em',
            color: 'hsl(var(--muted-foreground))',
          }}>
            Spelar nu
          </span>
        </div>

        {/* Value row — exact copy of controller temp row, showing track */}
        <div className="flex items-baseline gap-1.5">
          <MarqueeText>
            <span ref={trackNameRef} className="font-bold whitespace-nowrap" style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '22px',
              lineHeight: 1.05,
              color: 'hsl(0 0% 95%)',
            }}>
              {nowPlaying.track_name}
            </span>
            {nowPlaying.artist_name && (
              <span ref={artistNameRef} className="whitespace-nowrap" style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '15px',
                color: 'hsl(var(--muted-foreground))',
                opacity: 0.95,
              }}>
                › {nowPlaying.artist_name}
              </span>
            )}
          </MarqueeText>
        </div>

        {/* Bottom bar — exact copy of controller battery bar, showing progress */}
        {nowPlaying.duration_ms && (
          <div className="absolute bottom-0 left-0 right-0" style={{
            height: '2px',
            background: 'hsl(var(--muted) / 0.35)',
          }}>
            <div
              ref={progressBarRef}
              className="absolute top-0 bottom-0 left-0 transition-all duration-500"
              style={{
                width: `${Math.max(progress, 1)}%`,
                background: 'hsl(0 0% 95%)',
                opacity: 0.8,
                boxShadow: '0 0 3px hsl(0 0% 95% / 0.5)',
              }}
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
