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
  
  // Chromecast-optimized values - dramatic but lightweight
  // Using opacity and a simple color overlay instead of expensive filters
  const baseOpacity = 0.5;
  const peakOpacity = 1.0;
  
  // Scale is relatively cheap on GPU
  const baseScale = 1.02;
  const peakScale = isDiscoTempo ? 1.25 : isVeryHighTempo ? 1.18 : isHighTempo ? 1.12 : 1.08;

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

  // Animation loop - throttled to ~20fps for Chromecast
  useEffect(() => {
    if (!tempo || tempo <= 0) {
      setPulsePhase(0);
      return;
    }

    const beatDuration = (60 / tempo) * 1000;
    startTimeRef.current = performance.now();
    const frameInterval = 50; // ~20fps for Chromecast performance

    const animate = (currentTime: number) => {
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
        const hueStep = isDiscoTempo ? 60 : isVeryHighTempo ? 45 : 30;
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
  const currentOpacity = baseOpacity + (peakOpacity - baseOpacity) * pulsePhase;
  
  // Color overlay intensity based on pulse
  const overlayOpacity = pulsePhase * (isDiscoTempo ? 0.6 : isHighTempo ? 0.4 : 0.25);

  return (
    <>
      {/* Main background - NO expensive filters, just scale + opacity */}
      <div 
        className="fixed inset-0 bg-cover bg-center"
        style={{ 
          backgroundImage: `url(${currentImageUrl})`,
          transform: `scale(${currentScale})`,
          opacity: currentOpacity,
        }}
      />
      
      {/* Color flash overlay - simple solid color, very cheap to render */}
      <div 
        className="fixed inset-0 pointer-events-none"
        style={{ 
          backgroundColor: `hsl(${hueShift}, 70%, 50%)`,
          opacity: overlayOpacity,
          mixBlendMode: 'overlay',
        }}
      />
      
      {/* Preload element */}
      {preloadUrl && preloadUrl !== currentImageUrl && (
        <div 
          className="fixed inset-0 pointer-events-none opacity-0"
          style={{ backgroundImage: `url(${preloadUrl})` }}
          aria-hidden="true"
        />
      )}
      
      {/* Simple dark gradient for readability */}
      <div 
        className="fixed inset-0 pointer-events-none"
        style={{ 
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.3) 100%)',
          opacity: 1 - (pulsePhase * 0.3),
        }}
      />
    </>
  );
});
