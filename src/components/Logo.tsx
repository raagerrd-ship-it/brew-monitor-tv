import { useIsMobile } from "@/hooks/use-mobile";

export const Logo = () => {
  const isMobile = useIsMobile();

  const fontSize = isMobile ? 'min(6vh, 7vw)' : 'min(6vh, 2.8vw)';

  return (
    <span 
      className="font-bold tracking-tight"
      style={{ 
        fontSize,
        letterSpacing: '-0.01em',
        background: 'linear-gradient(135deg, hsl(45 95% 65%) 0%, hsl(38 90% 55%) 25%, hsl(35 70% 42%) 60%, hsl(30 65% 35%) 100%)',
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent',
        filter: 'drop-shadow(0 3px 4px hsl(30 60% 10% / 0.5))',
      }}
    >
      Bryggövervakare
    </span>
  );
};
