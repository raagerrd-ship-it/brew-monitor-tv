import { useAlbumArt } from '@/contexts/AlbumArtContext';

export function DashboardBackground() {
  const { visibleBgUrl } = useAlbumArt();

  if (!visibleBgUrl) return null;

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        backgroundImage: `url(${visibleBgUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center center',
      }}
    />
  );
}
