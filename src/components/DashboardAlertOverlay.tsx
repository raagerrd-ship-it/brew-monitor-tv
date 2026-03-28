import { useDashboardAlert } from '@/contexts/DashboardAlertContext';

export function DashboardAlertOverlay() {
  const { alert } = useDashboardAlert();

  if (!alert) return null;

  return (
    <div 
      className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none"
      style={{
        background: 'radial-gradient(ellipse at center, hsl(24 90% 50% / 0.25) 0%, hsl(0 0% 0% / 0.85) 100%)',
        animation: 'pulse-bg 1.5s ease-in-out infinite alternate',
      }}
    >
      {alert.content}
    </div>
  );
}
