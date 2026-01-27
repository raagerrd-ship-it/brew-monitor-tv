import { createContext, useContext, useState, useEffect, ReactNode, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

interface FpsCounterContextType {
  showFps: boolean;
  setShowFps: (show: boolean) => void;
  isLoading: boolean;
}

const FpsCounterContext = createContext<FpsCounterContextType>({
  showFps: false,
  setShowFps: () => {},
  isLoading: true,
});

export function FpsCounterProvider({ children }: { children: ReactNode }) {
  const [showFps, setShowFpsState] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const isLocalChange = useRef(false);

  // Load initial setting from database
  useEffect(() => {
    const loadSetting = async () => {
      try {
        const { data, error } = await supabase
          .from('sync_settings')
          .select('id, show_fps_counter')
          .limit(1)
          .maybeSingle();

        if (error) {
          console.error('Error loading FPS setting:', error);
          return;
        }

        if (data) {
          setSettingsId(data.id);
          setShowFpsState(data.show_fps_counter ?? false);
        }
      } catch (error) {
        console.error('Error loading FPS setting:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadSetting();
  }, []);

  // Subscribe to real-time updates
  useEffect(() => {
    const channel = supabase
      .channel('fps-counter-settings')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'sync_settings'
        },
        (payload) => {
          const newData = payload.new as { show_fps_counter?: boolean };
          if (newData.show_fps_counter !== undefined && !isLocalChange.current) {
            setShowFpsState(newData.show_fps_counter);
          }
          isLocalChange.current = false;
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const setShowFps = async (show: boolean) => {
    isLocalChange.current = true;
    setShowFpsState(show);
    
    if (settingsId) {
      const { error } = await supabase
        .from('sync_settings')
        .update({ show_fps_counter: show })
        .eq('id', settingsId);

      if (error) {
        console.error('Error updating FPS setting:', error);
        isLocalChange.current = false;
      }
    }
  };

  return (
    <FpsCounterContext.Provider value={{ showFps, setShowFps, isLoading }}>
      {children}
    </FpsCounterContext.Provider>
  );
}

export function useFpsCounter() {
  return useContext(FpsCounterContext);
}
