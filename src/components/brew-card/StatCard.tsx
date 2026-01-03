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
}: StatCardProps) {
  const baseStyles: CSSProperties = {
    containerType: 'size',
    borderColor: `${color}33`,
    borderWidth: '1px',
    borderStyle: 'solid',
    background: `linear-gradient(135deg, ${color}08 0%, hsl(222 18% 15% / 0.5) 100%)`,
    boxShadow: isUpdated 
      ? `0 0 25px ${color}66`
      : '0 6px 20px hsl(222 30% 3% / 0.6), 0 3px 8px hsl(222 30% 3% / 0.4), inset 0 1px 0 hsl(0 0% 100% / 0.06)',
    ...(isUpdated && { borderColor: `${color}66` })
  };

  const gridClass = colSpan > 1 || rowSpan > 1 
    ? `col-span-${colSpan} row-span-${rowSpan}` 
    : '';

  return (
    <div 
      className={`rounded-xl p-1.5 pr-3 flex flex-col items-start justify-center gap-0 relative overflow-hidden backdrop-blur-sm transition-all duration-1000 ${
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
        className="text-muted-foreground/60 tracking-wide z-10 pl-2 font-normal" 
        style={{ fontSize: 'max(11px, min(1.8vh, 1vw))' }}
      >
        {label}
      </p>
      <p 
        className={`font-bold leading-none z-10 pl-2 ${isUpdated ? 'animate-value-shimmer' : ''}`}
        style={{ 
          color,
          fontSize: 'max(28px, min(5.5vh, 2.5vw))',
          textShadow: `0 0 15px ${color}40`
        }}
      >
        {value}
      </p>
      {children}
    </div>
  );
}
