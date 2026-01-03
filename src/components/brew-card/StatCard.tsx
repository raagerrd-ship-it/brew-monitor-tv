import { ReactNode, CSSProperties } from "react";

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

// Helper to convert color to proper opacity format
function colorWithOpacity(color: string, opacity: number): string {
  // If it's an hsl(var(--x)) format, convert to hsl(var(--x) / opacity)
  if (color.startsWith('hsl(var(')) {
    const varName = color.match(/hsl\(var\((--[^)]+)\)\)/)?.[1];
    if (varName) {
      return `hsl(var(${varName}) / ${opacity})`;
    }
  }
  // If it's hsl(h s% l%) format, convert to hsl(h s% l% / opacity)
  if (color.startsWith('hsl(') && !color.includes('/')) {
    return color.replace(')', ` / ${opacity})`);
  }
  // For hex or other formats, use color-mix
  return `color-mix(in srgb, ${color} ${Math.round(opacity * 100)}%, transparent)`;
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
  labelSize = 'max(11px, min(1.8vh, 1vw))',
  valueSize = 'max(28px, min(5.5vh, 2.5vw))',
}: StatCardProps) {
  const baseStyles: CSSProperties = {
    containerType: 'size',
    borderColor: isUpdated ? colorWithOpacity(color, 0.5) : colorWithOpacity(color, 0.2),
    borderWidth: '1px',
    borderStyle: 'solid',
    background: customBackground || `linear-gradient(135deg, ${colorWithOpacity(color, 0.03)} 0%, hsl(222 18% 15% / 0.5) 100%)`,
    boxShadow: isUpdated 
      ? `0 0 25px ${colorWithOpacity(color, 0.5)}`
      : '0 6px 20px hsl(222 30% 3% / 0.6), 0 3px 8px hsl(222 30% 3% / 0.4), inset 0 1px 0 hsl(0 0% 100% / 0.06)',
  };

  const gridClass = colSpan > 1 || rowSpan > 1 
    ? `col-span-${colSpan} row-span-${rowSpan}` 
    : '';

  const alignmentClass = centered ? 'items-center' : 'items-start';
  const paddingClass = centered ? 'p-1' : 'p-1.5 pr-3';
  const textAlignClass = centered ? 'text-center px-1' : 'pl-2';

  return (
    <div 
      className={`rounded-xl ${paddingClass} flex flex-col ${alignmentClass} justify-center gap-0 relative overflow-hidden backdrop-blur-sm transition-all duration-1000 ${
        clickable ? 'cursor-pointer hover:opacity-80' : ''
      } ${isInactive ? 'opacity-40' : ''} ${gridClass} ${className}`}
      style={baseStyles}
      onClick={onClick}
      title={title}
    >
      {icon && (
        <div className="absolute top-1/2 -translate-y-1/2 opacity-10" style={{ width: '60%', height: '60%', right: '-15%' }}>
          {icon}
        </div>
      )}
      <p 
        className={`text-muted-foreground/60 tracking-wide z-10 font-normal ${textAlignClass}`}
        style={{ fontSize: labelSize }}
      >
        {label}
      </p>
      <p 
        className={`font-bold leading-none z-10 ${textAlignClass} ${isUpdated ? 'animate-value-shimmer' : ''}`}
        style={{ 
          color,
          fontSize: valueSize,
          textShadow: `0 0 15px ${colorWithOpacity(color, 0.3)}`
        }}
      >
        {value}
      </p>
      {children}
    </div>
  );
}
