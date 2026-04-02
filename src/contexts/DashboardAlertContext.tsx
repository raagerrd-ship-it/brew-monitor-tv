import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface DashboardAlert {
  /** Unique key to prevent duplicate alerts */
  id: string;
  /** The ReactNode content to display in the overlay */
  content: ReactNode;
  /** Auto-dismiss after this many milliseconds. null = manual dismiss only */
  autoDismissMs: number | null;
  /** Optional custom background for the overlay. Defaults to dark radial gradient */
  overlayBackground?: string;
  /** If set, a push notification is sent automatically when the alert fires */
  pushTitle?: string;
  /** Body text for the push notification */
  pushBody?: string;
}

interface DashboardAlertContextType {
  alert: DashboardAlert | null;
  showAlert: (alert: DashboardAlert) => void;
  dismissAlert: (id?: string) => void;
}

const DashboardAlertContext = createContext<DashboardAlertContextType>({
  alert: null,
  showAlert: () => {},
  dismissAlert: () => {},
});

export function useDashboardAlert() {
  return useContext(DashboardAlertContext);
}

export function DashboardAlertProvider({ children }: { children: ReactNode }) {
  const [alert, setAlert] = useState<DashboardAlert | null>(null);
  const sentPushIds = useRef(new Set<string>());

  const showAlert = useCallback((newAlert: DashboardAlert) => {
    setAlert(newAlert);

    // Send push notification if configured (once per alert id)
    if (newAlert.pushTitle && newAlert.pushBody && !sentPushIds.current.has(newAlert.id)) {
      sentPushIds.current.add(newAlert.id);
      supabase.functions.invoke('send-push-notification', {
        body: {
          title: newAlert.pushTitle,
          body: newAlert.pushBody,
          data: { alertId: newAlert.id },
        },
      }).catch(err => console.warn('Push notification failed:', err));
    }
  }, []);

  const dismissAlert = useCallback((id?: string) => {
    setAlert(prev => {
      if (!prev) return null;
      if (id && prev.id !== id) return prev;
      return null;
    });
  }, []);

  // Auto-dismiss timer
  useEffect(() => {
    if (!alert?.autoDismissMs) return;
    const timer = setTimeout(() => dismissAlert(alert.id), alert.autoDismissMs);
    return () => clearTimeout(timer);
  }, [alert?.id, alert?.autoDismissMs, dismissAlert]);

  return (
    <DashboardAlertContext.Provider value={{ alert, showAlert, dismissAlert }}>
      {children}
    </DashboardAlertContext.Provider>
  );
}
