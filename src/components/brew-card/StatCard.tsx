import { ReactNode, CSSProperties } from "react";
import { colorWithOpacity } from "./utils";

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
  labelSize = 'max(12px, min(2vh, 1.2vw))',
  valueSize = 'max(28px, min(5vh, 2.5vw))',
}: StatCardProps) {
  const baseStyles: CSSProperties = {
    borderColor: isUpdated ? colorWithOpacity(color, 0.5) : colorWithOpacity(color, 0.2),
    borderWidth: '1px',
    borderStyle: 'solid',
    background: customBackground || `linear-gradient(135deg, ${colorWithOpacity(color, 0.03)} 0%, hsl(222 18% 15% / 0.5) 100%)`,
    boxShadow: isUpdated 
      ? `0 0 25px ${colorWithOpacity(color, 0.5)}`
      : '0 6px 20px hsl(222 30% 3% / 0.6), 0 3px 8px hsl(222 30% 3% / 0.4), inset 0 1px 0 hsl(0 0% 100% / 0.06)',
  };

  // Use explicit classes for Tailwind purging to work correctly
  const colSpanClass = colSpan === 2 ? 'col-span-2' : colSpan === 3 ? 'col-span-3' : '';
  const rowSpanClass = rowSpan === 2 ? 'row-span-2' : rowSpan === 3 ? 'row-span-3' : '';
  const gridClass = `${colSpanClass} ${rowSpanClass}`.trim();

  const alignmentClass = centered ? 'items-center' : 'items-start';
  const paddingClass = centered ? 'p-0.5' : 'p-1 pr-2';
  const textAlignClass = centered ? 'text-center px-0.5' : 'pl-1.5';

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
        <div className="absolute top-1/2 -translate-y-1/2 opacity-10" style={{ width: '50%', height: '50%', right: '-10%' }}>
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
