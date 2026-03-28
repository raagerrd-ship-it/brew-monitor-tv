import { useDashboardAlert } from '@/contexts/DashboardAlertContext';

const DEFAULT_OVERLAY_BG = 'radial-gradient(ellipse at center, hsl(0 0% 0% / 0.6) 0%, hsl(0 0% 0% / 0.85) 100%)';

export function DashboardAlertOverlay() {
  const { alert } = useDashboardAlert();

  if (!alert) return null;

  return (
    <div 
      className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none"
      style={{
        background: alert.overlayBackground || DEFAULT_OVERLAY_BG,
        animation: 'pulse-bg 1.5s ease-in-out infinite alternate',
      }}
    >
      {alert.content}
    </div>
  );
}
