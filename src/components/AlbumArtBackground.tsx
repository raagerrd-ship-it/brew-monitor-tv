import { memo, useEffect, useRef, useState } from "react";

interface AlbumArtBackgroundProps {
  albumArtUrl: string;
  tempo: number | null;
  energy: number | null;
}

export const AlbumArtBackground = memo(function AlbumArtBackground({ 
  albumArtUrl, 
  tempo, 
  energy 
}: AlbumArtBackgroundProps) {
  const [pulsePhase, setPulsePhase] = useState(0); // 0 to 1
  const animationRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);

  // Calculate animation values based on energy (0-1 scale)
  const energyValue = energy ?? 0.5;
  
  // More dramatic values
  const baseScale = 1.08;
  const peakScale = 1.08 + (energyValue * 0.18); // 1.08 to 1.26
  
  const baseBrightness = 0.25;
  const peakBrightness = 0.45 + (energyValue * 0.35); // 0.45 to 0.80
  
  const baseBlur = 24;
  const peakBlur = 20 - (energyValue * 14); // 20px to 6px
  
  const baseOpacity = 0.45 + (energyValue * 0.1); // 0.45 to 0.55
  const peakOpacity = 0.85 + (energyValue * 0.1); // 0.85 to 0.95

  // JavaScript-based animation that runs in sync with tempo
  useEffect(() => {
    if (!tempo || tempo <= 0) {
      setPulsePhase(0);
      return;
    }

    // Duration of one pulse cycle in ms
    const cycleDuration = (60 / tempo) * 1000;
    startTimeRef.current = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTimeRef.current;
      // Calculate phase (0 to 1) using sine wave for smooth easing
      const rawPhase = (elapsed % cycleDuration) / cycleDuration;
      // Use sine wave for smooth pulse (0 -> 1 -> 0)
      const phase = Math.sin(rawPhase * Math.PI);
      setPulsePhase(phase);
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [tempo]);

  // Interpolate values based on pulse phase
  const currentScale = baseScale + (peakScale - baseScale) * pulsePhase;
  const currentBrightness = baseBrightness + (peakBrightness - baseBrightness) * pulsePhase;
  const currentBlur = baseBlur - (baseBlur - peakBlur) * pulsePhase;
  const currentOpacity = baseOpacity + (peakOpacity - baseOpacity) * pulsePhase;

  return (
    <>
      <div 
        className="fixed inset-0 bg-cover bg-center"
        style={{ 
          backgroundImage: `url(${albumArtUrl})`,
          filter: `blur(${currentBlur}px) brightness(${currentBrightness})`,
          transform: `scale(${currentScale})`,
          opacity: currentOpacity,
          willChange: 'transform, filter, opacity',
        }}
      />
      <div 
        className="fixed inset-0"
        style={{ 
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.5) 100%)',
        }}
      />
    </>
  );
});
