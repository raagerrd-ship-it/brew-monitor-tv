import { memo } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTvMode } from "@/contexts/TvModeContext";

function LogoComponent() {
  const isMobile = useIsMobile();
  const { isTvMode } = useTvMode();

  const fontSize = isMobile ? '28px' : isTvMode ? '28px' : '42px';

  // Different text based on TV mode
  const firstPart = "Brygg";
  const secondPart = isTvMode ? "övervakareTV" : "övervakare";

  return (
    <span 
      className="font-bold tracking-tight inline-flex relative"
      style={{ 
        fontSize,
        letterSpacing: '-0.01em',
      }}
    >
      {/* Brygg - ljus guld gradient */}
      <span
        className="logo-shimmer"
        style={{
          background: 'linear-gradient(145deg, hsl(45 95% 68%) 0%, hsl(38 90% 58%) 50%, hsl(35 85% 52%) 100%)',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
          filter: 'drop-shadow(0 3px 4px hsl(30 60% 10% / 0.5))',
        }}
      >
        {firstPart}
      </span>
      {/* övervakare / övervakareTV - mörk bärnsten gradient */}
      <span
        className="logo-shimmer"
        style={{ 
          background: 'linear-gradient(145deg, hsl(35 70% 42%) 0%, hsl(30 65% 35%) 50%, hsl(25 60% 28%) 100%)',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
          filter: 'drop-shadow(0 3px 4px hsl(30 60% 10% / 0.5))',
          animationDelay: '0.15s',
        }}
      >
        {secondPart}
      </span>
    </span>
  );
}

export const Logo = memo(LogoComponent);
