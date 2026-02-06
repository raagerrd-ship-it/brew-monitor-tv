import { ReactNode, CSSProperties } from "react";
import { colorWithOpacity } from "./utils";
import { useTvMode } from "@/contexts/TvModeContext";

interface StatCardProps {
  label: string;
  value: ReactNode;
  color?: string;
  isUpdated?: boolean;
  isInactive?: boolean;
  className?: string;
  onClick?: () => void;
  clickable?: boolean;
  title?: string;
  icon?: ReactNode;
  children?: ReactNode;
  colSpan?: number;
  rowSpan?: number;
  centered?: boolean;
  customBackground?: string;
  labelSize?: string;
  valueSize?: string;
}

export function StatCard({
  label,
  value,
  color = "hsl(var(--primary))",
  isUpdated = false,
  isInactive = false,
  className = "",
  onClick,
  clickable = false,
  title,
  icon,
  children,
  colSpan = 1,
  rowSpan = 1,
  centered = false,
  customBackground,
  labelSize,
  valueSize,
}: StatCardProps) {
  const { isTvMode } = useTvMode();
  
  // Sizes: same for both TV (720p native) and desktop (1080p scaled)
  const defaultLabelSize = '9px';
  const defaultValueSize = '28px';
  
  // Apply scaling to custom sizes too (0.7x from original design sizes)
  const finalLabelSize = labelSize 
    ? `${Math.round(parseInt(labelSize) * 0.7)}px`
    : defaultLabelSize;
  const finalValueSize = valueSize 
    ? `${Math.round(parseInt(valueSize) * 0.7)}px`
    : defaultValueSize;

  const baseStyles: CSSProperties = isTvMode ? {
    position: 'relative' as const,
  } : {
    borderColor: isUpdated ? colorWithOpacity(color, 0.5) : colorWithOpacity(color, 0.15),
    borderWidth: '1px',
    borderStyle: 'solid',
    background: customBackground || `linear-gradient(145deg, ${colorWithOpacity(color, 0.06)} 0%, hsl(222 20% 12% / 0.7) 100%)`,
    boxShadow: '0 8px 24px hsl(222 30% 3% / 0.5), 0 4px 10px hsl(222 30% 3% / 0.3), inset 0 1px 0 hsl(0 0% 100% / 0.08), inset 0 -1px 0 hsl(0 0% 0% / 0.15)',
    position: 'relative' as const,
  };

  const colSpanClass = colSpan === 2 ? 'col-span-2' : colSpan === 3 ? 'col-span-3' : '';
  const rowSpanClass = rowSpan === 2 ? 'row-span-2' : rowSpan === 3 ? 'row-span-3' : '';
  const gridClass = `${colSpanClass} ${rowSpanClass}`.trim();

  return (
    <div 
      className={`rounded-xl ${isTvMode ? 'p-2' : 'p-3'} flex flex-col items-center justify-center gap-0.5 relative overflow-visible ${isTvMode ? '' : 'backdrop-blur-md transition-all duration-700'} min-h-0 ${
        clickable ? 'cursor-pointer' : ''
      } ${isInactive ? 'opacity-40' : ''} ${gridClass} ${className}`}
      style={baseStyles}
      onClick={onClick}
      title={title}
    >
      {/* Top light reflection - desktop only */}
      {!isTvMode && (
        <div 
          className="absolute inset-x-0 top-0 h-[1px] pointer-events-none"
          style={{
            background: 'linear-gradient(90deg, transparent 15%, hsl(0 0% 100% / 0.1) 40%, hsl(0 0% 100% / 0.15) 50%, hsl(0 0% 100% / 0.1) 60%, transparent 85%)'
          }}
        />
      )}
      
      {icon && (
        <div className="absolute top-1/2 -translate-y-1/2 opacity-[0.08]" style={{ width: '55%', height: '55%', right: '-8%' }}>
          {icon}
        </div>
      )}
      
      <p 
        className="text-muted-foreground/50 uppercase tracking-widest z-10 font-medium text-center"
        style={{ fontSize: finalLabelSize, letterSpacing: '0.1em' }}
      >
        {label}
      </p>
      
      <p 
        className={`font-bold leading-none z-10 text-center ${isUpdated ? 'animate-value-shimmer' : ''}`}
        style={{ 
          color,
          fontSize: finalValueSize,
          textShadow: `0 0 25px ${colorWithOpacity(color, 0.4)}, 0 2px 6px hsl(0 0% 0% / 0.4)`,
          letterSpacing: '-0.02em'
        }}
      >
        {value}
      </p>
      
      {children}
    </div>
  );
}
