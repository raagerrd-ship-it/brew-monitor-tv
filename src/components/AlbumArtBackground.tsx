import { memo, useEffect, useRef, useState } from "react";

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
  const [currentImageUrl, setCurrentImageUrl] = useState(albumArtUrl);
  const [colorIndex, setColorIndex] = useState(0);
  const beatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const preloadedImagesRef = useRef<Set<string>>(new Set());

  // Disco color palette - bold colors that pop
  const discoColors = [
    'hsl(320, 80%, 50%)', // Magenta
    'hsl(200, 90%, 50%)', // Cyan
    'hsl(45, 95%, 55%)',  // Gold
    'hsl(280, 75%, 55%)', // Purple
    'hsl(140, 70%, 45%)', // Green
    'hsl(15, 90%, 55%)',  // Orange
  ];

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

  // Update image when album art changes
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

  const tempoValue = tempo ?? 100;
  const energyValue = energy ?? 0.5;
  
  const isHighTempo = tempoValue > 120;
  const isDiscoTempo = tempoValue > 150;

  // Simple interval-based beat flash - works great at low fps
  useEffect(() => {
    if (!tempo || tempo <= 0) {
      setIsFlashing(false);
      return;
    }

    // Flash duration: brief flash on each beat
    const beatMs = (60 / tempo) * 1000;
    const flashDuration = Math.min(beatMs * 0.3, 150); // Flash for 30% of beat or max 150ms

    const triggerFlash = () => {
      setIsFlashing(true);
      setColorIndex(prev => (prev + 1) % discoColors.length);
      
      setTimeout(() => {
        setIsFlashing(false);
      }, flashDuration);
    };

    // Initial flash
    triggerFlash();
    
    // Set up interval for beats
    beatIntervalRef.current = setInterval(triggerFlash, beatMs);

    return () => {
      if (beatIntervalRef.current) {
        clearInterval(beatIntervalRef.current);
      }
    };
  }, [tempo, discoColors.length]);

  // Discrete states - no interpolation needed, works at any fps
  const scale = isFlashing ? (isDiscoTempo ? 1.15 : isHighTempo ? 1.1 : 1.06) : 1.0;
  const imageOpacity = isFlashing ? 1.0 : 0.6;
  const overlayOpacity = isFlashing ? (isDiscoTempo ? 0.5 : isHighTempo ? 0.35 : 0.2) : 0;

  return (
    <>
      {/* Album art background - discrete scale states */}
      <div 
        className="fixed inset-0 bg-cover bg-center"
        style={{ 
          backgroundImage: `url(${currentImageUrl})`,
          transform: `scale(${scale})`,
          opacity: imageOpacity,
          // CSS transition handles smoothing even at low fps
          transition: isFlashing ? 'none' : 'transform 200ms ease-out, opacity 200ms ease-out',
        }}
      />
      
      {/* Color flash overlay - instant on, fade out */}
      <div 
        className="fixed inset-0 pointer-events-none"
        style={{ 
          backgroundColor: discoColors[colorIndex],
          opacity: overlayOpacity,
          mixBlendMode: 'overlay',
          transition: isFlashing ? 'none' : 'opacity 300ms ease-out',
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
      
      {/* Dark overlay for readability - less dark when flashing */}
      <div 
        className="fixed inset-0 pointer-events-none bg-black"
        style={{ 
          opacity: isFlashing ? 0.1 : 0.35,
          transition: isFlashing ? 'none' : 'opacity 200ms ease-out',
        }}
      />
    </>
  );
});
