import { memo, useEffect, useRef, useState, useCallback } from "react";

interface AlbumArtBackgroundProps {
  albumArtUrl: string;
  tempo: number | null;
  energy: number | null;
  preloadUrl?: string | null;
}

export const AlbumArtBackground = memo(function AlbumArtBackground({ 
  albumArtUrl, 
  tempo, 
  energy,
  preloadUrl
}: AlbumArtBackgroundProps) {
  const [pulsePhase, setPulsePhase] = useState(0); // 0 to 1
  const [currentImageUrl, setCurrentImageUrl] = useState(albumArtUrl);
  const [nextImageLoaded, setNextImageLoaded] = useState(false);
  const animationRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const preloadedImagesRef = useRef<Set<string>>(new Set());

  // Preload next track's album art
  useEffect(() => {
    if (preloadUrl && !preloadedImagesRef.current.has(preloadUrl)) {
      const img = new Image();
      img.onload = () => {
        preloadedImagesRef.current.add(preloadUrl);
        setNextImageLoaded(true);
      };
      img.src = preloadUrl;
    }
  }, [preloadUrl]);

  // Smooth transition when album art changes
  useEffect(() => {
    if (albumArtUrl !== currentImageUrl) {
      // If next image is preloaded, transition immediately
      if (preloadedImagesRef.current.has(albumArtUrl)) {
        setCurrentImageUrl(albumArtUrl);
      } else {
        // Preload then transition
        const img = new Image();
        img.onload = () => {
          preloadedImagesRef.current.add(albumArtUrl);
          setCurrentImageUrl(albumArtUrl);
        };
        img.src = albumArtUrl;
      }
    }
  }, [albumArtUrl, currentImageUrl]);

  // Calculate animation values based on energy (0-1 scale)
  const energyValue = energy ?? 0.5;
  const tempoValue = tempo ?? 100;
  
  // For high tempo (>120 BPM), use more aggressive heartbeat effect
  const isHighTempo = tempoValue > 120;
  const isVeryHighTempo = tempoValue > 140;
  
  // Dynamic scale based on tempo - higher tempo = more pronounced heartbeat
  const baseScale = 1.05;
  const tempoScaleBoost = isVeryHighTempo ? 0.25 : isHighTempo ? 0.18 : 0.12;
  const peakScale = baseScale + (energyValue * tempoScaleBoost); // More dramatic for high tempo
  
  const baseBrightness = 0.2;
  const peakBrightness = 0.4 + (energyValue * 0.4); // 0.4 to 0.80
  
  const baseBlur = 28;
  const peakBlur = 16 - (energyValue * 12); // 16px to 4px
  
  const baseOpacity = 0.4;
  const peakOpacity = 0.85 + (energyValue * 0.1); // 0.85 to 0.95

  // Heartbeat-style easing function - quick attack, slower release
  const heartbeatEase = useCallback((t: number): number => {
    // Create a sharper "thump" at the beat with quick attack and slower decay
    // This mimics a heartbeat more than a sine wave
    if (t < 0.15) {
      // Quick attack to peak (0 -> 1 in first 15%)
      return Math.sin((t / 0.15) * (Math.PI / 2));
    } else {
      // Slower decay (1 -> 0 in remaining 85%)
      const decayT = (t - 0.15) / 0.85;
      return Math.cos(decayT * (Math.PI / 2));
    }
  }, []);

  // JavaScript-based animation that runs in sync with tempo
  useEffect(() => {
    if (!tempo || tempo <= 0) {
      setPulsePhase(0);
      return;
    }

    // Duration of one beat cycle in ms
    const beatDuration = (60 / tempo) * 1000;
    startTimeRef.current = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTimeRef.current;
      // Calculate position within beat cycle (0 to 1)
      const rawPhase = (elapsed % beatDuration) / beatDuration;
      // Apply heartbeat easing for snappy attack, smooth release
      const phase = heartbeatEase(rawPhase);
      setPulsePhase(phase);
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [tempo, heartbeatEase]);

  // Interpolate values based on pulse phase
  const currentScale = baseScale + (peakScale - baseScale) * pulsePhase;
  const currentBrightness = baseBrightness + (peakBrightness - baseBrightness) * pulsePhase;
  const currentBlur = baseBlur - (baseBlur - peakBlur) * pulsePhase;
  const currentOpacity = baseOpacity + (peakOpacity - baseOpacity) * pulsePhase;

  return (
    <>
      {/* Main visible background */}
      <div 
        className="fixed inset-0 bg-cover bg-center transition-[background-image] duration-500"
        style={{ 
          backgroundImage: `url(${currentImageUrl})`,
          filter: `blur(${currentBlur}px) brightness(${currentBrightness})`,
          transform: `scale(${currentScale})`,
          opacity: currentOpacity,
          willChange: 'transform, filter, opacity',
        }}
      />
      
      {/* Hidden preload element for next track */}
      {preloadUrl && preloadUrl !== currentImageUrl && (
        <div 
          className="fixed inset-0 pointer-events-none opacity-0"
          style={{ 
            backgroundImage: `url(${preloadUrl})`,
          }}
          aria-hidden="true"
        />
      )}
      
      {/* Gradient overlay */}
      <div 
        className="fixed inset-0"
        style={{ 
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.5) 100%)',
        }}
      />
    </>
  );
});
