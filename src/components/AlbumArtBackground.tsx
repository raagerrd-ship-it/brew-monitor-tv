import { memo, useEffect, useState } from "react";

interface AlbumArtBackgroundProps {
  albumArtUrl: string;
  tempo: number | null;
  energy: number | null;
  preloadUrl?: string | null;
}

export const AlbumArtBackground = memo(function AlbumArtBackground({ 
  albumArtUrl, 
  preloadUrl
}: AlbumArtBackgroundProps) {
  const [currentImageUrl, setCurrentImageUrl] = useState(albumArtUrl);

  // Update image when album art changes
  useEffect(() => {
    if (albumArtUrl) {
      setCurrentImageUrl(albumArtUrl);
    }
  }, [albumArtUrl]);

  // Preload next track
  useEffect(() => {
    if (preloadUrl && preloadUrl !== albumArtUrl) {
      const img = new Image();
      img.src = preloadUrl;
    }
  }, [preloadUrl, albumArtUrl]);

  return (
    <>
      {/* Album art background - clear and visible */}
      <div 
        className="fixed inset-0 bg-cover bg-center transition-[background-image] duration-500"
        style={{ 
          backgroundImage: `url(${currentImageUrl})`,
          transform: 'scale(1.05)',
          filter: 'blur(8px) brightness(0.8) saturate(1.3)',
        }}
      />
      
      {/* Subtle gradient for readability */}
      <div 
        className="fixed inset-0 pointer-events-none"
        style={{ 
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.4) 100%)',
        }}
      />
    </>
  );
});
