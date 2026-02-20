import { memo } from "react";

interface ProgressOverlayProps {
  progress: number | null;
  color: 'green' | 'amber' | 'purple' | 'blue';
}

const colorMap = {
  green: { start: 'hsl(142 70% 45% / 0.25)', end: 'hsl(142 70% 50% / 0.15)' },
  amber: { start: 'hsl(38 92% 50% / 0.2)', end: 'hsl(38 92% 50% / 0.08)' },
  purple: { start: 'hsl(280 70% 50% / 0.25)', end: 'hsl(280 70% 55% / 0.15)' },
  blue: { start: 'hsl(200 90% 50% / 0.1)', end: 'hsl(200 90% 50% / 0.05)' },
} as const;

export const ProgressOverlay = memo(function ProgressOverlay({ 
  progress, 
  color 
}: ProgressOverlayProps) {
  if (progress === null || progress <= 0) return null;
  
  const colors = colorMap[color];
  const percentage = progress * 100;
  
  return (
    <div 
      className="absolute inset-0 pointer-events-none transition-all duration-1000"
      style={{
        background: `linear-gradient(90deg, 
          ${colors.start} 0%, 
          ${colors.end} ${percentage}%, 
          transparent ${percentage}%)`,
      }}
    />
  );
});



export const ShimmerOverlay = memo(function ShimmerOverlay() {
  return (
    <div 
      className="absolute inset-x-0 top-0 h-[1px] pointer-events-none"
      style={{
        background: 'linear-gradient(90deg, transparent 10%, hsl(0 0% 100% / 0.15) 50%, transparent 90%)'
      }}
    />
  );
});
