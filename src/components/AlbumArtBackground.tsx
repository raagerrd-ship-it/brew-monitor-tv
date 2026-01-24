import { memo, useEffect, useRef, useState } from "react";

// Static color palette - outside component to prevent re-creation
const DISCO_COLORS = [
  'hsl(320, 80%, 50%)', // Magenta
  'hsl(200, 90%, 50%)', // Cyan
  'hsl(45, 95%, 55%)',  // Gold
  'hsl(280, 75%, 55%)', // Purple
  'hsl(140, 70%, 45%)', // Green
  'hsl(15, 90%, 55%)',  // Orange
];

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
  const [isFlashing, setIsFlashing] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [currentImageUrl, setCurrentImageUrl] = useState(albumArtUrl);
  const [colorIndex, setColorIndex] = useState(0);
  const beatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load current image
  useEffect(() => {
    setImageLoaded(false);
    const img = new Image();
    img.onload = () => {
      setCurrentImageUrl(albumArtUrl);
      setImageLoaded(true);
    };
    img.onerror = () => {
      setImageLoaded(true); // Continue anyway
    };
    img.src = albumArtUrl;
  }, [albumArtUrl]);

  // Preload next track (simple, no state changes)
  useEffect(() => {
    if (preloadUrl && preloadUrl !== albumArtUrl) {
      const img = new Image();
      img.src = preloadUrl;
    }
  }, [preloadUrl, albumArtUrl]);

  const tempoValue = tempo ?? 100;
  const isHighTempo = tempoValue > 120;
  const isDiscoTempo = tempoValue > 150;

  // Beat flash - only runs when image is loaded
  useEffect(() => {
    // Clear any existing intervals/timeouts
    if (beatIntervalRef.current) {
      clearInterval(beatIntervalRef.current);
      beatIntervalRef.current = null;
    }
    if (flashTimeoutRef.current) {
      clearTimeout(flashTimeoutRef.current);
      flashTimeoutRef.current = null;
    }

    // Don't start until image is loaded and we have a valid tempo
    if (!imageLoaded || !tempo || tempo <= 0) {
      setIsFlashing(false);
      return;
    }

    const beatMs = (60 / tempo) * 1000;
    const flashDuration = Math.min(beatMs * 0.25, 120);

    const triggerFlash = () => {
      setIsFlashing(true);
      setColorIndex(prev => (prev + 1) % 6);
      
      flashTimeoutRef.current = setTimeout(() => {
        setIsFlashing(false);
      }, flashDuration);
    };

    // Delay first flash slightly
    flashTimeoutRef.current = setTimeout(() => {
      triggerFlash();
      beatIntervalRef.current = setInterval(triggerFlash, beatMs);
    }, 100);

    return () => {
      if (beatIntervalRef.current) {
        clearInterval(beatIntervalRef.current);
      }
      if (flashTimeoutRef.current) {
        clearTimeout(flashTimeoutRef.current);
      }
    };
  }, [imageLoaded, tempo]);

  // Don't render anything complex until image is loaded
  if (!imageLoaded) {
    return <div className="fixed inset-0 bg-black" />;
  }

  const scale = isFlashing ? (isDiscoTempo ? 1.12 : isHighTempo ? 1.08 : 1.05) : 1.0;

  return (
    <>
      {/* Album art background */}
      <div 
        className="fixed inset-0 bg-cover bg-center"
        style={{ 
          backgroundImage: `url(${currentImageUrl})`,
          transform: `scale(${scale})`,
          opacity: isFlashing ? 1 : 0.55,
          transition: isFlashing ? 'none' : 'transform 150ms, opacity 150ms',
        }}
      />
      
      {/* Color flash */}
      <div 
        className="fixed inset-0 pointer-events-none"
        style={{ 
          backgroundColor: DISCO_COLORS[colorIndex],
          opacity: isFlashing ? (isDiscoTempo ? 0.45 : 0.3) : 0,
          mixBlendMode: 'overlay',
          transition: isFlashing ? 'none' : 'opacity 200ms',
        }}
      />
      
      {/* Dark overlay */}
      <div 
        className="fixed inset-0 pointer-events-none bg-black"
        style={{ opacity: isFlashing ? 0.05 : 0.3 }}
      />
    </>
  );
});
