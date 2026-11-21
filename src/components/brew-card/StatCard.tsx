import { ReactNode, CSSProperties } from "react";
import { colorWithOpacity } from "./utils";
import { useTvMode } from "@/contexts/TvModeContext";

/** Gemensam kombinerad stapel: spår + fyllnad + valfritt streckat segment, markör, punkt och tunn underlinje. Allt flyttas med transform. */
export function MiniBar({ from = 0, to, color, ghost, marker, markerColor, dot, under }: {
  from?: number; to: number; color: string;
  ghost?: [number, number]; marker?: number; markerColor?: string; dot?: number;
  under?: { pct: number; color: string };
}) {
  const { isTvMode } = useTvMode();
  const anim = isTvMode ? 'tv-value-bar' : '';
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  const seg = (a: number, b: number) => ({ transform: `translateX(${clamp(a)}%) scaleX(${Math.max(clamp(b) - clamp(a), 0) / 100})`, transformOrigin: 'left' });
  const at = (v: number) => ({ transform: `translateX(${clamp(v)}%)` });
  return (
    <div className="w-full">
      <div className="relative w-full h-[8px] rounded-full overflow-hidden bg-foreground/10">
        <div className={`absolute inset-y-0 left-0 w-full rounded-full ${anim}`} style={{ ...seg(from, to), background: color }} />
        {ghost && ghost[1] - ghost[0] > 0.5 && (
          <div className={`absolute inset-y-0 left-0 w-full ${anim}`} style={{ ...seg(ghost[0], ghost[1]), background: `repeating-linear-gradient(90deg, ${color} 0 3px, transparent 3px 6px)`, opacity: 0.55 }} />
        )}
        {marker !== undefined && (
          <div className={`absolute inset-0 ${anim}`} style={at(marker)}><div className="absolute inset-y-0 left-0 w-[3px] -translate-x-1/2 rounded-full" style={{ background: markerColor ?? 'hsl(var(--foreground))' }} /></div>
        )}
        {dot !== undefined && (
          <div className={`absolute inset-0 ${anim}`} style={at(dot)}><div className="absolute top-0 left-0 h-[8px] w-[8px] -translate-x-1/2 rounded-full bg-foreground" /></div>
        )}
      </div>
      {under && (
        <div className="relative w-full h-[3px] mt-[2px] rounded-full overflow-hidden bg-foreground/10">
          <div className={`absolute inset-y-0 left-0 w-full rounded-full ${anim}`} style={{ ...seg(0, under.pct), background: under.color }} />
        </div>
      )}
    </div>
  );
}

/** Etikettrad för ministaplar: läsbar utan tooltip. */
export const statDetailClass = "flex flex-wrap justify-between items-baseline gap-x-1.5 text-muted-foreground/80 tabular-nums tracking-tight leading-none text-[12px] whitespace-nowrap";

interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  color?: string;
  isUpdated?: boolean;
  isInactive?: boolean;
  className?: string;
  onClick?: () => void;
  clickable?: boolean;
  title?: string;
  children?: ReactNode;
  subValue?: ReactNode;
  colSpan?: number;
  rowSpan?: number;
  
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
  children,
  subValue,
  colSpan = 1,
  rowSpan = 1,
  
  customBackground,
  labelSize,
  valueSize,
}: StatCardProps) {
  const { isTvMode } = useTvMode();
  const defaultLabelSize = '10px';
  const defaultValueSize = '28px';
  
  const finalLabelSize = labelSize 
    ? `${Math.round(parseInt(labelSize) * 0.7)}px`
    : defaultLabelSize;
  const finalValueSize = valueSize 
    ? `${Math.round(parseInt(valueSize) * 0.7)}px`
    : defaultValueSize;

  const baseStyles: CSSProperties = {
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
      className={`rounded-xl p-2 flex flex-col items-center justify-center gap-0.5 relative overflow-hidden min-h-0 ${
        clickable ? 'cursor-pointer' : ''
      } ${isInactive ? 'opacity-40' : ''} ${gridClass} ${className}`}
      style={baseStyles}
      onClick={onClick}
      title={title}
    >
      
      {/* Top light reflection */}
      <div 
        className="absolute inset-x-0 top-0 h-[1px] pointer-events-none"
        style={{
          background: 'linear-gradient(90deg, transparent 15%, hsl(0 0% 100% / 0.1) 40%, hsl(0 0% 100% / 0.15) 50%, hsl(0 0% 100% / 0.1) 60%, transparent 85%)'
        }}
      />
      
      <p 
        className="text-muted-foreground/70 uppercase tracking-widest z-10 font-medium text-center"
        style={{ fontSize: finalLabelSize, letterSpacing: '0.1em' }}
      >
        {label}
      </p>
      
      <p 
        className="font-bold leading-none z-10 text-center"
        style={{ 
          color,
          fontSize: finalValueSize,
          textShadow: isTvMode ? 'none' : `0 0 25px ${colorWithOpacity(color, 0.4)}, 0 2px 6px hsl(0 0% 0% / 0.4)`,
          letterSpacing: '-0.02em'
        }}
      >
        {value}
      </p>
      
      {subValue && (
        <div className="z-10">{subValue}</div>
      )}
      
      {children}
    </div>
  );
}
