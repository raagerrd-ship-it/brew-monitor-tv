import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';

export interface DashboardAlert {
  /** Unique key to prevent duplicate alerts */
  id: string;
  /** The ReactNode content to display in the overlay */
  content: ReactNode;
  /** Auto-dismiss after this many milliseconds. null = manual dismiss only */
  autoDismissMs: number | null;
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

  const showAlert = useCallback((newAlert: DashboardAlert) => {
    setAlert(newAlert);
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
