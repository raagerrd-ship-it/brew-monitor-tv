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
  const [pulsePhase, setPulsePhase] = useState(0);
  const [currentImageUrl, setCurrentImageUrl] = useState(albumArtUrl);
  const [hueShift, setHueShift] = useState(0);
  const animationRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const preloadedImagesRef = useRef<Set<string>>(new Set());
  const beatCountRef = useRef<number>(0);
  const lastUpdateRef = useRef<number>(0);

  // Preload next track's album art
  useEffect(() => {
    if (preloadUrl && !preloadedImagesRef.current.has(preloadUrl)) {
      const img = new Image();
      img.onload = () => {
        preloadedImagesRef.current.add(preloadUrl);
      };
      img.src = preloadUrl;
    }
  }, [preloadUrl]);

  // Smooth transition when album art changes
  useEffect(() => {
    if (albumArtUrl !== currentImageUrl) {
      if (preloadedImagesRef.current.has(albumArtUrl)) {
        setCurrentImageUrl(albumArtUrl);
      } else {
        const img = new Image();
        img.onload = () => {
          preloadedImagesRef.current.add(albumArtUrl);
          setCurrentImageUrl(albumArtUrl);
        };
        img.src = albumArtUrl;
      }
    }
  }, [albumArtUrl, currentImageUrl]);

  const energyValue = energy ?? 0.5;
  const tempoValue = tempo ?? 100;
  
  const isHighTempo = tempoValue > 120;
  const isVeryHighTempo = tempoValue > 140;
  const isDiscoTempo = tempoValue > 160;
  
  // Dramatic but optimized values
  const baseScale = 1.05;
  const scaleIntensity = isDiscoTempo ? 0.45 : isVeryHighTempo ? 0.35 : isHighTempo ? 0.28 : 0.20;
  const peakScale = baseScale + (energyValue * scaleIntensity);
  
  const baseBrightness = 0.3;
  const peakBrightness = isDiscoTempo ? 1.3 : isVeryHighTempo ? 1.15 : 1.0;
  
  // Less blur variation = less GPU work
  const baseBlur = 15;
  const peakBlur = isDiscoTempo ? 2 : isVeryHighTempo ? 4 : 6;
  
  const baseOpacity = 0.6;
  const peakOpacity = 1.0;
  
  const baseSaturation = 1.3;
  const peakSaturation = isDiscoTempo ? 2.0 : isVeryHighTempo ? 1.8 : 1.5;

  const discoHeartbeatEase = useCallback((t: number): number => {
    const attackDuration = isDiscoTempo ? 0.08 : isVeryHighTempo ? 0.1 : 0.15;
    
    if (t < attackDuration) {
      return Math.pow(t / attackDuration, 0.5);
    } else {
      const decayT = (t - attackDuration) / (1 - attackDuration);
      const decayPower = isDiscoTempo ? 3 : isVeryHighTempo ? 2.5 : 2;
      return Math.pow(1 - decayT, decayPower);
    }
  }, [isDiscoTempo, isVeryHighTempo]);

  // Optimized animation loop - throttle to ~30fps for performance
  useEffect(() => {
    if (!tempo || tempo <= 0) {
      setPulsePhase(0);
      return;
    }

    const beatDuration = (60 / tempo) * 1000;
    startTimeRef.current = performance.now();
    const frameInterval = 33; // ~30fps instead of 60fps

    const animate = (currentTime: number) => {
      // Throttle updates
      if (currentTime - lastUpdateRef.current < frameInterval) {
        animationRef.current = requestAnimationFrame(animate);
        return;
      }
      lastUpdateRef.current = currentTime;

      const elapsed = currentTime - startTimeRef.current;
      const beatNumber = Math.floor(elapsed / beatDuration);
      const rawPhase = (elapsed % beatDuration) / beatDuration;
      
      const phase = discoHeartbeatEase(rawPhase);
      setPulsePhase(phase);
      
      if (beatNumber !== beatCountRef.current) {
        beatCountRef.current = beatNumber;
        const hueStep = isDiscoTempo ? 45 : isVeryHighTempo ? 35 : 25;
        setHueShift(prev => (prev + hueStep) % 360);
      }
      
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [tempo, discoHeartbeatEase, isDiscoTempo, isVeryHighTempo]);

  const currentScale = baseScale + (peakScale - baseScale) * pulsePhase;
  const currentBrightness = baseBrightness + (peakBrightness - baseBrightness) * pulsePhase;
  const currentBlur = baseBlur - (baseBlur - peakBlur) * pulsePhase;
  const currentOpacity = baseOpacity + (peakOpacity - baseOpacity) * pulsePhase;
  const currentSaturation = baseSaturation + (peakSaturation - baseSaturation) * pulsePhase;
  const currentHueRotate = isHighTempo ? hueShift * pulsePhase * 0.5 : 0;

  return (
    <>
      {/* Main background - simplified filter for performance */}
      <div 
        className="fixed inset-0 bg-cover bg-center transition-[background-image] duration-300"
        style={{ 
          backgroundImage: `url(${currentImageUrl})`,
          filter: `blur(${currentBlur}px) brightness(${currentBrightness}) saturate(${currentSaturation}) hue-rotate(${currentHueRotate}deg)`,
          transform: `scale(${currentScale})`,
          opacity: currentOpacity,
          willChange: 'transform, opacity',
        }}
      />
      
      {/* Single color overlay - simpler gradient for performance */}
      {isHighTempo && (
        <div 
          className="fixed inset-0 pointer-events-none"
          style={{ 
            background: `radial-gradient(circle at 50% 50%, hsla(${hueShift}, 85%, 50%, ${pulsePhase * 0.4}) 0%, transparent 60%)`,
            mixBlendMode: 'overlay',
          }}
        />
      )}
      
      {/* Preload element */}
      {preloadUrl && preloadUrl !== currentImageUrl && (
        <div 
          className="fixed inset-0 pointer-events-none opacity-0"
          style={{ backgroundImage: `url(${preloadUrl})` }}
          aria-hidden="true"
        />
      )}
      
      {/* Minimal gradient overlay */}
      <div 
        className="fixed inset-0 pointer-events-none"
        style={{ 
          background: `linear-gradient(to bottom, rgba(0,0,0,${0.1 - pulsePhase * 0.05}) 0%, rgba(0,0,0,${0.25 - pulsePhase * 0.1}) 100%)`,
        }}
      />
    </>
  );
});
