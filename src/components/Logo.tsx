import { useIsMobile } from "@/hooks/use-mobile";

// Custom hop/thermometer SVG icon
const HopIcon = ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
  <svg 
    viewBox="0 0 48 48" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={style}
  >
    {/* Central hop cone body */}
    <ellipse cx="24" cy="22" rx="10" ry="12" fill="url(#hopGradient)" opacity="0.9" />
    
    {/* Hop leaves/petals - layered for depth */}
    <ellipse cx="16" cy="18" rx="5" ry="7" fill="url(#hopGradient)" opacity="0.8" transform="rotate(-20 16 18)" />
    <ellipse cx="32" cy="18" rx="5" ry="7" fill="url(#hopGradient)" opacity="0.8" transform="rotate(20 32 18)" />
    <ellipse cx="14" cy="26" rx="4" ry="6" fill="url(#hopGradient)" opacity="0.7" transform="rotate(-30 14 26)" />
    <ellipse cx="34" cy="26" rx="4" ry="6" fill="url(#hopGradient)" opacity="0.7" transform="rotate(30 34 26)" />
    <ellipse cx="18" cy="32" rx="3.5" ry="5" fill="url(#hopGradient)" opacity="0.6" transform="rotate(-15 18 32)" />
    <ellipse cx="30" cy="32" rx="3.5" ry="5" fill="url(#hopGradient)" opacity="0.6" transform="rotate(15 30 32)" />
    
    {/* Top leaves */}
    <ellipse cx="20" cy="12" rx="4" ry="5" fill="url(#hopGradient)" opacity="0.85" transform="rotate(-10 20 12)" />
    <ellipse cx="28" cy="12" rx="4" ry="5" fill="url(#hopGradient)" opacity="0.85" transform="rotate(10 28 12)" />
    
    {/* Stem */}
    <path d="M24 36 L24 44" stroke="url(#stemGradient)" strokeWidth="2.5" strokeLinecap="round" />
    <path d="M24 40 L20 42" stroke="url(#stemGradient)" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M24 38 L28 40" stroke="url(#stemGradient)" strokeWidth="1.5" strokeLinecap="round" />
    
    {/* Small thermometer accent on the side */}
    <rect x="36" y="16" width="3" height="14" rx="1.5" fill="hsl(200 70% 50%)" opacity="0.7" />
    <circle cx="37.5" cy="28" r="2.5" fill="hsl(200 70% 50%)" opacity="0.8" />
    <rect x="37" y="18" width="1" height="8" fill="hsl(200 90% 70%)" opacity="0.9" />
    
    {/* Highlight on central body */}
    <ellipse cx="21" cy="19" rx="3" ry="4" fill="white" opacity="0.15" />
    
    <defs>
      <linearGradient id="hopGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="hsl(38 90% 60%)" />
        <stop offset="50%" stopColor="hsl(45 95% 55%)" />
        <stop offset="100%" stopColor="hsl(38 85% 50%)" />
      </linearGradient>
      <linearGradient id="stemGradient" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="hsl(38 70% 45%)" />
        <stop offset="100%" stopColor="hsl(35 60% 35%)" />
      </linearGradient>
    </defs>
  </svg>
);

export const Logo = () => {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div className="relative">
        <HopIcon 
          className="h-9 w-9"
          style={{
            filter: 'drop-shadow(0 2px 4px hsl(38 90% 40% / 0.3))',
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {/* Icon */}
      <HopIcon 
        className="h-12 w-12"
        style={{
          filter: 'drop-shadow(0 2px 8px hsl(38 90% 40% / 0.4))',
        }}
      />
      
      {/* Text */}
      <div className="flex flex-col leading-none">
        <span 
          className="font-bold tracking-tight"
          style={{ 
            fontSize: 'min(4.5vh, 2vw)',
            background: 'linear-gradient(135deg, hsl(38 90% 60%) 0%, hsl(45 95% 65%) 50%, hsl(38 85% 55%) 100%)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
            textShadow: 'none',
            letterSpacing: '-0.02em',
          }}
        >
          Brygg
        </span>
        <span 
          className="font-light tracking-wide"
          style={{ 
            fontSize: 'min(2.8vh, 1.2vw)',
            color: 'hsl(40 10% 70%)',
            letterSpacing: '0.15em',
            marginTop: '-0.1em',
          }}
        >
          ÖVERVAKARE
        </span>
      </div>
    </div>
  );
};
