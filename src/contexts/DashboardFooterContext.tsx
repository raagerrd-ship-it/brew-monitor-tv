import { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';

interface DashboardFooterContextType {
  /** Sum of all active slots — the space reserved at the bottom. */
  footerHeight: number;
  footerContent: ReactNode | null;
  /** Height of content-less slots (self-rendering, e.g. TimerFooter) that the content sits above. */
  footerContentOffset: number;
  footerContentHeight: number;
  setFooterSlot: (content: ReactNode, height: number, key?: string) => void;
  clearFooterSlot: (key?: string) => void;
}

const DashboardFooterContext = createContext<DashboardFooterContextType>({
  footerHeight: 0,
  footerContent: null,
  footerContentOffset: 0,
  footerContentHeight: 0,
  setFooterSlot: () => {},
  clearFooterSlot: () => {},
});

export function useDashboardFooter() {
  return useContext(DashboardFooterContext);
}

type Slot = { content: ReactNode | null; height: number };

export function DashboardFooterProvider({ children }: { children: ReactNode }) {
  const [slots, setSlots] = useState<Record<string, Slot>>({});

  const setFooterSlot = useCallback((content: ReactNode, height: number, key = 'default') => {
    setSlots((prev) => ({ ...prev, [key]: { content, height } }));
  }, []);

  const clearFooterSlot = useCallback((key = 'default') => {
    setSlots((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const value = useMemo(() => {
    const list = Object.values(slots);
    const withContent = list.find((s) => s.content != null) ?? null;
    return {
      footerHeight: list.reduce((n, s) => n + s.height, 0),
      footerContent: withContent?.content ?? null,
      footerContentOffset: list.filter((s) => s.content == null).reduce((n, s) => n + s.height, 0),
      footerContentHeight: withContent?.height ?? 0,
      setFooterSlot,
      clearFooterSlot,
    };
  }, [slots, setFooterSlot, clearFooterSlot]);
  return (
    <DashboardFooterContext.Provider value={value}>
      {children}
    </DashboardFooterContext.Provider>
  );
}
