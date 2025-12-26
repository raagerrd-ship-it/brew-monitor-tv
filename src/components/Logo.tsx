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
        }}
      >
        Brygg
      </span>
      <span
        style={{ 
          color: 'hsl(35 65% 38%)',
        }}
      >
        övervakare
      </span>
    </span>
  );
};
