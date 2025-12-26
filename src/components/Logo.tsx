import { useIsMobile } from "@/hooks/use-mobile";

export const Logo = () => {
  const isMobile = useIsMobile();

  return (
    <span 
      className="font-bold tracking-tight"
      style={{ 
        fontSize: isMobile ? 'min(5vh, 6vw)' : 'min(5vh, 2.2vw)',
        letterSpacing: '-0.01em',
      }}
    >
      <span
        style={{
          background: 'linear-gradient(135deg, hsl(38 90% 60%) 0%, hsl(45 95% 65%) 50%, hsl(38 85% 55%) 100%)',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
          filter: 'drop-shadow(0 2px 4px hsl(38 80% 30% / 0.5))',
        }}
      >
        Brygg
      </span>
      <span
        style={{ 
          color: 'hsl(35 65% 38%)',
          textShadow: '0 2px 4px hsl(35 50% 20% / 0.4)',
        }}
      >
        övervakare
      </span>
    </span>
  );
};
