import { useIsMobile } from "@/hooks/use-mobile";

export const Logo = () => {
  const isMobile = useIsMobile();

  const fontSize = isMobile ? 'min(6vh, 7vw)' : 'min(6vh, 2.8vw)';

  return (
    <span 
      className="font-bold tracking-tight relative"
      style={{ 
        fontSize,
        letterSpacing: '-0.01em',
      }}
    >
      {/* Shadow layer */}
      <span
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          color: 'hsl(30 60% 15%)',
          filter: 'blur(4px)',
          opacity: 0.6,
          transform: 'translateY(3px)',
        }}
      >
        Bryggövervakare
      </span>
      
      {/* Visible text */}
      <span className="relative">
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
    </span>
  );
};
