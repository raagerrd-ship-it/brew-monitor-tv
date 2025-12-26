import { useIsMobile } from "@/hooks/use-mobile";

export const Logo = () => {
  const isMobile = useIsMobile();

  const fontSize = isMobile ? 'min(6vh, 7vw)' : 'min(6vh, 2.8vw)';

  return (
    <span 
      className="font-bold tracking-tight inline-flex"
      style={{ 
        fontSize,
        letterSpacing: '-0.01em',
      }}
    >
      {/* Brygg - ljus guld gradient */}
      <span
        style={{
          background: 'linear-gradient(145deg, hsl(45 95% 68%) 0%, hsl(38 90% 58%) 50%, hsl(35 85% 52%) 100%)',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
          filter: 'drop-shadow(0 3px 4px hsl(30 60% 10% / 0.5))',
        }}
      >
        Brygg
      </span>
      {/* övervakare - mörk bärnsten gradient */}
      <span
        style={{ 
          background: 'linear-gradient(145deg, hsl(35 70% 42%) 0%, hsl(30 65% 35%) 50%, hsl(25 60% 28%) 100%)',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
          filter: 'drop-shadow(0 3px 4px hsl(30 60% 10% / 0.5))',
        }}
      >
        övervakare
      </span>
    </span>
  );
};
