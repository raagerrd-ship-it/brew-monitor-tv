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
      {/* Brygg with gradient - using filter for shadow since text-shadow doesn't work with background-clip */}
      <span
        style={{
          background: 'linear-gradient(135deg, hsl(38 90% 60%) 0%, hsl(45 95% 65%) 50%, hsl(38 85% 55%) 100%)',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
          filter: 'drop-shadow(0 3px 3px hsl(30 60% 10% / 0.6))',
        }}
      >
        Brygg
      </span>
      {/* övervakare with text-shadow */}
      <span
        style={{ 
          color: 'hsl(35 65% 38%)',
          textShadow: '0 3px 4px hsl(30 60% 10% / 0.6)',
        }}
      >
        övervakare
      </span>
    </span>
  );
};
