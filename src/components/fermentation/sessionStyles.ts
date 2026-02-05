export type VisualState = 'waiting' | 'ramping' | 'normal';

export function getBackgroundStyle(state: VisualState): string {
  // Enhanced glassmorphism with deeper transparency
  switch (state) {
    case 'waiting':
      return 'linear-gradient(145deg, hsl(200 90% 50% / 0.12) 0%, hsl(222 20% 12% / 0.7) 100%)';
    case 'ramping':
      return 'linear-gradient(145deg, hsl(38 92% 50% / 0.1) 0%, hsl(222 20% 12% / 0.7) 100%)';
    default:
      return 'linear-gradient(145deg, hsl(var(--primary) / 0.08) 0%, hsl(222 20% 12% / 0.7) 100%)';
  }
}

export function getBorderColor(state: VisualState): string {
  switch (state) {
    case 'waiting':
      return 'hsl(200 90% 50% / 0.25)';
    case 'ramping':
      return 'hsl(38 92% 50% / 0.2)';
    default:
      return 'hsl(var(--primary) / 0.15)';
  }
}

export function getBoxShadow(state: VisualState): string {
  // Deep floating shadow + inset light reflection matching StatCard
  const baseShadow = '0 8px 24px hsl(222 30% 3% / 0.5), 0 4px 10px hsl(222 30% 3% / 0.3), inset 0 1px 0 hsl(0 0% 100% / 0.08), inset 0 -1px 0 hsl(0 0% 0% / 0.15)';
  
  switch (state) {
    case 'waiting':
      return baseShadow;
    case 'ramping':
      return baseShadow;
    default:
      return baseShadow;
  }
}

export function getTopReflection(): string {
  return 'linear-gradient(90deg, transparent 15%, hsl(0 0% 100% / 0.1) 40%, hsl(0 0% 100% / 0.15) 50%, hsl(0 0% 100% / 0.1) 60%, transparent 85%)';
}

export function formatRemainingTime(remainingHours: number): string {
  const hours = Math.floor(remainingHours);
  const minutes = Math.round((remainingHours - hours) * 60);
  if (hours === 0) {
    return `${minutes}min kvar`;
  }
  return `${hours}h ${minutes}min kvar`;
}
