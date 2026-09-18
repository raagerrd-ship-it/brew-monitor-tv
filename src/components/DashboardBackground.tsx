import { useAlbumArt } from '@/contexts/AlbumArtContext';
import defaultBackground from '@/assets/dahlsjo-bryggeri-ren-1080p.jpg.asset.json';

export function DashboardBackground() {
  const { visibleBgUrl } = useAlbumArt();
  const backgroundUrl = visibleBgUrl || defaultBackground.url;

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        backgroundImage: `url(${backgroundUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center center',
      }}
    />
  );
}
