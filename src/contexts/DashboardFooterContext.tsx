import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface DashboardFooterContextType {
  footerHeight: number;
  footerContent: ReactNode | null;
  setFooterSlot: (content: ReactNode, height: number) => void;
  clearFooterSlot: () => void;
}

const DashboardFooterContext = createContext<DashboardFooterContextType>({
  footerHeight: 0,
  footerContent: null,
  setFooterSlot: () => {},
  clearFooterSlot: () => {},
});

export function useDashboardFooter() {
  return useContext(DashboardFooterContext);
}

export function DashboardFooterProvider({ children }: { children: ReactNode }) {
  const [footerHeight, setFooterHeight] = useState(0);
  const [footerContent, setFooterContent] = useState<ReactNode | null>(null);

  const setFooterSlot = useCallback((content: ReactNode, height: number) => {
    setFooterContent(content);
    setFooterHeight(height);
  }, []);

  const clearFooterSlot = useCallback(() => {
    setFooterContent(null);
    setFooterHeight(0);
  }, []);

  return (
    <DashboardFooterContext.Provider value={{ footerHeight, footerContent, setFooterSlot, clearFooterSlot }}>
      {children}
    </DashboardFooterContext.Provider>
  );
}
