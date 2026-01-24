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
  const [hueShift, setHueShift] = useState(0);
  const animationRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const preloadedImagesRef = useRef<Set<string>>(new Set());
  const beatCountRef = useRef<number>(0);

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

  // Calculate animation values based on energy (0-1 scale)
  const energyValue = energy ?? 0.5;
  const tempoValue = tempo ?? 100;
  
  // Disco mode: higher tempo = more intense effects
  const isHighTempo = tempoValue > 120;
  const isVeryHighTempo = tempoValue > 140;
  const isDiscoTempo = tempoValue > 160;
  
  // Dynamic scale - VERY pronounced for disco effect
  const baseScale = 1.0;
  const scaleIntensity = isDiscoTempo ? 0.35 : isVeryHighTempo ? 0.28 : isHighTempo ? 0.22 : 0.15;
  const peakScale = baseScale + (energyValue * scaleIntensity);
  
  // Brightness - disco mode gets much brighter flashes
  const baseBrightness = 0.15;
  const peakBrightness = isDiscoTempo ? 0.9 : isVeryHighTempo ? 0.8 : 0.65 + (energyValue * 0.25);
  
  // Blur - sharper at peak for disco effect
  const baseBlur = 30;
  const peakBlur = isDiscoTempo ? 2 : isVeryHighTempo ? 4 : 8 - (energyValue * 6);
  
  // Opacity - more dramatic swings for disco
  const baseOpacity = 0.3;
  const peakOpacity = isDiscoTempo ? 1.0 : 0.9 + (energyValue * 0.1);
  
  // Saturation boost for disco effect
  const baseSaturation = 1.0;
  const peakSaturation = isDiscoTempo ? 1.8 : isVeryHighTempo ? 1.5 : 1.2;

  // Disco heartbeat easing - sharp attack, quick release for strobe-like effect
  const discoHeartbeatEase = useCallback((t: number, intensity: number): number => {
    // For disco, use even sharper attack
    const attackDuration = isDiscoTempo ? 0.08 : isVeryHighTempo ? 0.1 : 0.15;
    
    if (t < attackDuration) {
      // Super quick attack to peak
      const attackProgress = t / attackDuration;
      return Math.pow(attackProgress, 0.5); // Fast ramp up
    } else {
      // Quick decay for strobe effect at high tempo
      const decayT = (t - attackDuration) / (1 - attackDuration);
      const decayPower = isDiscoTempo ? 3 : isVeryHighTempo ? 2.5 : 2;
      return Math.pow(1 - decayT, decayPower);
    }
  }, [isDiscoTempo, isVeryHighTempo]);

  // JavaScript-based animation synced to tempo with disco effects
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
      const beatNumber = Math.floor(elapsed / beatDuration);
      const rawPhase = (elapsed % beatDuration) / beatDuration;
      
      // Apply disco heartbeat easing
      const phase = discoHeartbeatEase(rawPhase, energyValue);
      setPulsePhase(phase);
      
      // Update hue shift on each beat (disco color cycling)
      if (beatNumber !== beatCountRef.current) {
        beatCountRef.current = beatNumber;
        // Shift hue by 30-60 degrees on each beat for color variety
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
  }, [tempo, energyValue, discoHeartbeatEase, isDiscoTempo, isVeryHighTempo]);

  // Interpolate values based on pulse phase
  const currentScale = baseScale + (peakScale - baseScale) * pulsePhase;
  const currentBrightness = baseBrightness + (peakBrightness - baseBrightness) * pulsePhase;
  const currentBlur = baseBlur - (baseBlur - peakBlur) * pulsePhase;
  const currentOpacity = baseOpacity + (peakOpacity - baseOpacity) * pulsePhase;
  const currentSaturation = baseSaturation + (peakSaturation - baseSaturation) * pulsePhase;
  
  // Hue rotation for disco effect (only apply at high tempo)
  const currentHueRotate = isHighTempo ? hueShift * pulsePhase * 0.5 : 0;

  return (
    <>
      {/* Main visible background with disco effects */}
      <div 
        className="fixed inset-0 bg-cover bg-center transition-[background-image] duration-300"
        style={{ 
          backgroundImage: `url(${currentImageUrl})`,
          filter: `blur(${currentBlur}px) brightness(${currentBrightness}) saturate(${currentSaturation}) hue-rotate(${currentHueRotate}deg)`,
          transform: `scale(${currentScale})`,
          opacity: currentOpacity,
          willChange: 'transform, filter, opacity',
        }}
      />
      
      {/* Color overlay for disco effect at high tempo */}
      {isHighTempo && (
        <div 
          className="fixed inset-0 pointer-events-none mix-blend-overlay"
          style={{ 
            background: `radial-gradient(circle at 50% 50%, hsla(${hueShift}, 80%, 50%, ${pulsePhase * 0.3}) 0%, transparent 70%)`,
            opacity: pulsePhase * energyValue,
          }}
        />
      )}
      
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
      
      {/* Gradient overlay - less intense during disco peaks */}
      <div 
        className="fixed inset-0"
        style={{ 
          background: `linear-gradient(to bottom, rgba(0,0,0,${0.25 - pulsePhase * 0.15}) 0%, rgba(0,0,0,${0.5 - pulsePhase * 0.2}) 100%)`,
        }}
      />
    </>
  );
});
