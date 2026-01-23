export type VisualState = 'waiting' | 'ramping' | 'normal';

export function getBackgroundStyle(state: VisualState): string {
  switch (state) {
    case 'waiting':
      return 'linear-gradient(135deg, hsl(200 90% 50% / 0.15) 0%, hsl(200 90% 50% / 0.08) 100%)';
    case 'ramping':
      return 'linear-gradient(135deg, hsl(38 92% 50% / 0.12) 0%, hsl(var(--primary) / 0.08) 100%)';
    default:
      return 'linear-gradient(135deg, hsl(var(--primary) / 0.1) 0%, hsl(var(--primary) / 0.05) 100%)';
  }
}

export function getBorderColor(state: VisualState): string {
  switch (state) {
    case 'waiting':
      return 'hsl(200 90% 50% / 0.3)';
    case 'ramping':
      return 'hsl(38 92% 50% / 0.25)';
    default:
      return 'hsl(var(--primary) / 0.2)';
  }
}

export function getBoxShadow(state: VisualState): string {
  switch (state) {
    case 'waiting':
      return '0 4px 20px hsl(200 90% 50% / 0.2), inset 0 1px 0 hsl(0 0% 100% / 0.1)';
    case 'ramping':
      return '0 4px 20px hsl(38 92% 50% / 0.15), inset 0 1px 0 hsl(0 0% 100% / 0.1)';
    default:
      return '0 4px 16px hsl(var(--primary) / 0.1), inset 0 1px 0 hsl(0 0% 100% / 0.08)';
  }
}

export function formatRemainingTime(remainingHours: number): string {
  const hours = Math.floor(remainingHours);
  const minutes = Math.round((remainingHours - hours) * 60);
  if (hours === 0) {
    return `${minutes}min kvar`;
  }
  return `${hours}h ${minutes}min kvar`;
}
