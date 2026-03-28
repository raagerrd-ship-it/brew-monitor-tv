import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface DashboardFooterContextType {
  footerHeight: number;
  setFooterContent: (height: number | null) => void;
}

const DashboardFooterContext = createContext<DashboardFooterContextType>({
  footerHeight: 0,
  setFooterContent: () => {},
});

export function useDashboardFooter() {
  return useContext(DashboardFooterContext);
}

export function DashboardFooterProvider({ children }: { children: ReactNode }) {
  const [footerHeight, setFooterHeight] = useState(0);

  const setFooterContent = useCallback((height: number | null) => {
    setFooterHeight(height ?? 0);
  }, []);

  return (
    <DashboardFooterContext.Provider value={{ footerHeight, setFooterContent }}>
      {children}
    </DashboardFooterContext.Provider>
  );
}
