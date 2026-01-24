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
  
  // Dynamic scale - VERY pronounced for maximum room visibility
  const baseScale = 1.05;
  const scaleIntensity = isDiscoTempo ? 0.50 : isVeryHighTempo ? 0.40 : isHighTempo ? 0.32 : 0.25;
  const peakScale = baseScale + (energyValue * scaleIntensity);
  
  // Brightness - MUCH brighter flashes to light up the room
  const baseBrightness = 0.25;
  const peakBrightness = isDiscoTempo ? 1.4 : isVeryHighTempo ? 1.2 : 1.0 + (energyValue * 0.3);
  
  // Blur - very sharp at peak for maximum impact
  const baseBlur = 20;
  const peakBlur = isDiscoTempo ? 0 : isVeryHighTempo ? 1 : 3 - (energyValue * 2);
  
  // Opacity - always high for visibility
  const baseOpacity = 0.5;
  const peakOpacity = 1.0;
  
  // Saturation boost - vivid colors
  const baseSaturation = 1.2;
  const peakSaturation = isDiscoTempo ? 2.2 : isVeryHighTempo ? 1.9 : 1.6;
  
  // Contrast boost for punch
  const baseContrast = 1.0;
  const peakContrast = isDiscoTempo ? 1.4 : isVeryHighTempo ? 1.3 : 1.2;

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
  const currentContrast = baseContrast + (peakContrast - baseContrast) * pulsePhase;
  
  // Hue rotation for disco effect (only apply at high tempo)
  const currentHueRotate = isHighTempo ? hueShift * pulsePhase * 0.6 : 0;

  return (
    <>
      {/* Main visible background with enhanced disco effects */}
      <div 
        className="fixed inset-0 bg-cover bg-center transition-[background-image] duration-300"
        style={{ 
          backgroundImage: `url(${currentImageUrl})`,
          filter: `blur(${currentBlur}px) brightness(${currentBrightness}) saturate(${currentSaturation}) contrast(${currentContrast}) hue-rotate(${currentHueRotate}deg)`,
          transform: `scale(${currentScale})`,
          opacity: currentOpacity,
          willChange: 'transform, filter, opacity',
        }}
      />
      
      {/* Intense color overlay for disco effect - visible at all tempos but stronger at high */}
      <div 
        className="fixed inset-0 pointer-events-none"
        style={{ 
          background: `radial-gradient(ellipse 120% 100% at 50% 50%, hsla(${hueShift}, 90%, 55%, ${pulsePhase * (isDiscoTempo ? 0.5 : isHighTempo ? 0.35 : 0.2)}) 0%, hsla(${(hueShift + 180) % 360}, 80%, 40%, ${pulsePhase * 0.15}) 50%, transparent 80%)`,
          mixBlendMode: 'overlay',
        }}
      />
      
      {/* Secondary glow layer for extra room presence */}
      <div 
        className="fixed inset-0 pointer-events-none"
        style={{ 
          background: `conic-gradient(from ${hueShift}deg at 50% 50%, hsla(${hueShift}, 100%, 60%, ${pulsePhase * 0.25}) 0deg, transparent 60deg, hsla(${(hueShift + 120) % 360}, 100%, 50%, ${pulsePhase * 0.2}) 120deg, transparent 180deg, hsla(${(hueShift + 240) % 360}, 100%, 55%, ${pulsePhase * 0.2}) 240deg, transparent 300deg, hsla(${hueShift}, 100%, 60%, ${pulsePhase * 0.25}) 360deg)`,
          opacity: isHighTempo ? 1 : 0.5,
          mixBlendMode: 'screen',
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
      
      {/* Gradient overlay - more transparent for room visibility */}
      <div 
        className="fixed inset-0"
        style={{ 
          background: `linear-gradient(to bottom, rgba(0,0,0,${0.15 - pulsePhase * 0.1}) 0%, rgba(0,0,0,${0.35 - pulsePhase * 0.2}) 100%)`,
        }}
      />
    </>
  );
});
