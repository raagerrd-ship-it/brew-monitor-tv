import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface TimerContextType {
  isTimerVisible: boolean;
  setTimerVisible: (visible: boolean) => void;
}

const TimerContext = createContext<TimerContextType>({
  isTimerVisible: false,
  setTimerVisible: () => {},
});

export function useTimerVisibility() {
  return useContext(TimerContext);
}

export function TimerProvider({ children }: { children: ReactNode }) {
  const [isTimerVisible, setTimerVisible] = useState(false);

  return (
    <TimerContext.Provider value={{ isTimerVisible, setTimerVisible }}>
      {children}
    </TimerContext.Provider>
  );
}
