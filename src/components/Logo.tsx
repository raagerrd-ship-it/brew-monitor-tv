import { useIsMobile } from "@/hooks/use-mobile";

// Stylized beer glass SVG icon
const BeerGlassIcon = ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
  <svg 
    viewBox="0 0 48 48" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={style}
  >
    {/* Glass body - slightly tapered */}
    <path 
      d="M12 12 L14 42 C14 44 16 46 24 46 C32 46 34 44 34 42 L36 12 Z" 
      fill="url(#beerGradient)" 
      stroke="hsl(38 30% 70%)" 
      strokeWidth="1"
      opacity="0.95"
    />
    
    {/* Glass highlight/reflection */}
    <path 
      d="M14 14 L15.5 40 C15.5 41 16.5 42 18 42" 
      stroke="white" 
      strokeWidth="2" 
      strokeLinecap="round"
      opacity="0.25"
    />
    
    {/* Foam top */}
    <ellipse cx="24" cy="12" rx="12" ry="4" fill="hsl(45 50% 95%)" />
    <ellipse cx="20" cy="10" rx="4" ry="2.5" fill="hsl(45 60% 98%)" />
    <ellipse cx="28" cy="11" rx="3.5" ry="2" fill="hsl(45 60% 98%)" />
    <ellipse cx="24" cy="9" rx="3" ry="1.8" fill="white" />
    <ellipse cx="17" cy="12" rx="2.5" ry="1.5" fill="hsl(45 60% 98%)" />
    <ellipse cx="31" cy="12" rx="2" ry="1.2" fill="white" />
    
    {/* Bubbles rising */}
    <circle cx="20" cy="30" r="1.2" fill="white" opacity="0.4" />
    <circle cx="26" cy="35" r="0.8" fill="white" opacity="0.35" />
    <circle cx="22" cy="25" r="1" fill="white" opacity="0.3" />
    <circle cx="28" cy="28" r="0.9" fill="white" opacity="0.35" />
    <circle cx="19" cy="38" r="0.7" fill="white" opacity="0.3" />
    
    {/* Handle */}
    <path 
      d="M36 18 C42 18 44 22 44 28 C44 34 42 38 36 38" 
      stroke="hsl(38 30% 65%)" 
      strokeWidth="3" 
      strokeLinecap="round"
      fill="none"
    />
    <path 
      d="M36 20 C40 20 42 23 42 28 C42 33 40 36 36 36" 
      stroke="hsl(38 40% 80%)" 
      strokeWidth="1" 
      strokeLinecap="round"
      fill="none"
      opacity="0.5"
    />
    
    <defs>
      <linearGradient id="beerGradient" x1="0%" y1="0%" x2="100%" y2="100%">
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
        <BeerGlassIcon 
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
      <BeerGlassIcon 
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
