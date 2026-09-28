import { useEffect, useState } from 'react';
import { useAlbumArt } from '@/contexts/AlbumArtContext';
import defaultBackground from '@/assets/dahlsjo-bryggeri-ren-1080p.jpg.asset.json';

export function DashboardBackground() {
  const { visibleBgUrl } = useAlbumArt();
  const backgroundUrl = visibleBgUrl || defaultBackground.url;
  const [layers, setLayers] = useState<{ prev: string | null; cur: string }>({ prev: null, cur: backgroundUrl });

  useEffect(() => {
    setLayers(l => (l.cur === backgroundUrl ? l : { prev: l.cur, cur: backgroundUrl }));
  }, [backgroundUrl]);

  const layerStyle = (url: string) => ({
    backgroundImage: `url(${url})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center center',
  });

  return (
    <div className="absolute inset-0 pointer-events-none">
      {layers.prev && <div className="absolute inset-0" style={layerStyle(layers.prev)} />}
      <div
        key={layers.cur}
        className="absolute inset-0"
        style={{ ...layerStyle(layers.cur), animation: layers.prev ? 'bg-fade-in 0.8s ease-out both' : undefined }}
        onAnimationEnd={() => setLayers(l => (l.prev ? { prev: null, cur: l.cur } : l))}
      />
    </div>
  );
}
