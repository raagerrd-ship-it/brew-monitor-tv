import { createContext, useContext, useState, useEffect, ReactNode } from "react";

interface FpsCounterContextType {
  showFps: boolean;
  setShowFps: (show: boolean) => void;
}

const FpsCounterContext = createContext<FpsCounterContextType>({
  showFps: false,
  setShowFps: () => {},
});

const STORAGE_KEY = "fps-counter-enabled";

export function FpsCounterProvider({ children }: { children: ReactNode }) {
  const [showFps, setShowFpsState] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(STORAGE_KEY) === "true";
  });

  const setShowFps = (show: boolean) => {
    setShowFpsState(show);
    localStorage.setItem(STORAGE_KEY, show ? "true" : "false");
  };

  // Sync across tabs
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setShowFpsState(e.newValue === "true");
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  return (
    <FpsCounterContext.Provider value={{ showFps, setShowFps }}>
      {children}
    </FpsCounterContext.Provider>
  );
}

export function useFpsCounter() {
  return useContext(FpsCounterContext);
}
