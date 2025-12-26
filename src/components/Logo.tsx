import { useIsMobile } from "@/hooks/use-mobile";

// Stylized beer stein/sejdel SVG icon
const BeerSteinIcon = ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
  <svg 
    viewBox="0 0 48 48" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={style}
  >
    {/* Stein body - straight sided mug */}
    <rect 
      x="8" y="10" width="24" height="34" rx="2"
      fill="url(#steinBeerGradient)" 
      stroke="hsl(38 30% 60%)" 
      strokeWidth="1.5"
    />
    
    {/* Horizontal bands/rings on stein */}
    <line x1="8" y1="18" x2="32" y2="18" stroke="hsl(38 40% 50%)" strokeWidth="1" opacity="0.5" />
    <line x1="8" y1="36" x2="32" y2="36" stroke="hsl(38 40% 50%)" strokeWidth="1" opacity="0.5" />
    
    {/* Glass highlight/reflection */}
    <rect x="10" y="12" width="3" height="28" rx="1" fill="white" opacity="0.2" />
    
    {/* Foam top */}
    <ellipse cx="20" cy="10" rx="12" ry="4" fill="hsl(45 50% 95%)" />
    <ellipse cx="16" cy="8" rx="4" ry="2.5" fill="hsl(45 60% 98%)" />
    <ellipse cx="24" cy="9" rx="3.5" ry="2" fill="hsl(45 60% 98%)" />
    <ellipse cx="20" cy="7" rx="3" ry="1.8" fill="white" />
    <ellipse cx="13" cy="10" rx="2.5" ry="1.5" fill="hsl(45 60% 98%)" />
    <ellipse cx="27" cy="10" rx="2" ry="1.2" fill="white" />
    
    {/* Foam drip on side */}
    <path d="M30 10 Q32 12 31 16" stroke="hsl(45 50% 95%)" strokeWidth="2" fill="none" strokeLinecap="round" />
    
    {/* Bubbles rising */}
    <circle cx="16" cy="28" r="1" fill="white" opacity="0.4" />
    <circle cx="22" cy="32" r="0.8" fill="white" opacity="0.35" />
    <circle cx="18" cy="24" r="0.8" fill="white" opacity="0.3" />
    <circle cx="25" cy="26" r="0.7" fill="white" opacity="0.35" />
    
    {/* Handle - thick curved handle typical for sejdel */}
    <path 
      d="M32 14 L36 14 C42 14 44 20 44 27 C44 34 42 40 36 40 L32 40" 
      stroke="hsl(38 35% 55%)" 
      strokeWidth="4" 
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
    {/* Handle inner edge highlight */}
    <path 
      d="M33 17 L35 17 C39 17 41 22 41 27 C41 32 39 37 35 37 L33 37" 
      stroke="hsl(38 45% 75%)" 
      strokeWidth="1.5" 
      strokeLinecap="round"
      fill="none"
      opacity="0.6"
    />
    
    <defs>
      <linearGradient id="steinBeerGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="hsl(38 90% 55%)" />
        <stop offset="50%" stopColor="hsl(35 85% 50%)" />
        <stop offset="100%" stopColor="hsl(30 80% 45%)" />
      </linearGradient>
    </defs>
  </svg>
);

export const Logo = () => {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div className="relative">
        <BeerSteinIcon 
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
      <BeerSteinIcon 
        className="h-12 w-12"
        style={{
          filter: 'drop-shadow(0 2px 8px hsl(38 90% 40% / 0.4))',
        }}
      />
      
      {/* Text as unified word */}
      <span 
        className="font-bold tracking-tight"
        style={{ 
          fontSize: 'min(4vh, 1.8vw)',
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
    </div>
  );
};
