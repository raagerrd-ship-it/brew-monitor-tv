import { memo } from "react";
import { useIsMobile } from "@/hooks";
import { useTvMode } from "@/contexts/TvModeContext";

function LogoComponent() {
  const isMobile = useIsMobile();
  const { isTvMode } = useTvMode();
  const fontSize = isMobile ? '30px' : '34px';

  const firstPart = "Brygg";
  const secondPart = "övervakare";
  const suffix = isTvMode ? "TV" : null;

  return (
    <span 
      className="inline-flex items-baseline relative"
      style={{ 
        fontFamily: "'Cormorant Garamond', Georgia, serif",
        fontSize,
        fontWeight: 700,
        letterSpacing: '0.02em',
      }}
    >
      {/* Brygg — warm bright copper */}
      <span
        className="logo-shimmer"
        style={{
          background: 'linear-gradient(160deg, hsl(42 100% 72%) 0%, hsl(36 95% 60%) 40%, hsl(30 85% 50%) 100%)',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
          textShadow: 'none',
          filter: 'drop-shadow(0 2px 6px hsl(30 80% 15% / 0.6))',
        }}
      >
        {firstPart}
      </span>
      {/* övervakare — italic, lighter amber */}
      <span
        className="logo-shimmer"
        style={{ 
          fontWeight: 500,
          fontStyle: 'italic',
          background: 'linear-gradient(160deg, hsl(38 70% 55%) 0%, hsl(32 60% 45%) 50%, hsl(28 50% 38%) 100%)',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
          textShadow: 'none',
          filter: 'drop-shadow(0 2px 6px hsl(30 80% 15% / 0.6))',
          animationDelay: '0.15s',
        }}
      >
        {secondPart}
      </span>
      {/* TV suffix — small caps style */}
      {suffix && (
        <span
          style={{
            fontWeight: 600,
            fontStyle: 'normal',
            fontSize: '0.5em',
            letterSpacing: '0.12em',
            marginLeft: '0.25em',
            alignSelf: 'center',
            background: 'linear-gradient(160deg, hsl(38 60% 50%) 0%, hsl(30 50% 40%) 100%)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
            filter: 'drop-shadow(0 1px 3px hsl(30 80% 15% / 0.4))',
            textTransform: 'uppercase',
          }}
        >
          {suffix}
        </span>
      )}
    </span>
  );
}

export const Logo = memo(LogoComponent);
