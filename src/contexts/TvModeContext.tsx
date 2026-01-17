import { createContext, useContext, ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

interface TvModeContextType {
  isTvMode: boolean;
}

const TvModeContext = createContext<TvModeContextType>({ isTvMode: false });

export function TvModeProvider({ children }: { children: ReactNode }) {
  const [searchParams] = useSearchParams();
  const isTvMode = searchParams.get('tv') === 'true';

  return (
    <TvModeContext.Provider value={{ isTvMode }}>
      {children}
    </TvModeContext.Provider>
  );
}

export function useTvMode() {
  return useContext(TvModeContext);
}
