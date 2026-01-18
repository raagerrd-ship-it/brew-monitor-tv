import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useExternalAuth } from '@/contexts/ExternalAuthContext';

interface ExternalUserSettings {
  timerTvModeOnly: boolean;
  isLoading: boolean;
}

export function useExternalUserSettings() {
  const { user: externalUser, isAuthenticated } = useExternalAuth();
  const [settings, setSettings] = useState<ExternalUserSettings>({
    timerTvModeOnly: true, // Default to true
    isLoading: true,
  });

  // Load settings from database
  useEffect(() => {
    if (!isAuthenticated || !externalUser?.id) {
      setSettings(prev => ({ ...prev, isLoading: false }));
      return;
    }

    const loadSettings = async () => {
      try {
        const { data, error } = await supabase
          .from('external_user_settings')
          .select('timer_tv_mode_only')
          .eq('external_user_id', externalUser.id)
          .maybeSingle();

        if (error) {
          console.error('Error loading external user settings:', error);
          setSettings(prev => ({ ...prev, isLoading: false }));
          return;
        }

        if (data) {
          setSettings({
            timerTvModeOnly: data.timer_tv_mode_only,
            isLoading: false,
          });
        } else {
          // No settings found, use defaults
          setSettings({
            timerTvModeOnly: true,
            isLoading: false,
          });
        }
      } catch (error) {
        console.error('Error loading external user settings:', error);
        setSettings(prev => ({ ...prev, isLoading: false }));
      }
    };

    loadSettings();
  }, [isAuthenticated, externalUser?.id]);

  // Update timer TV mode only setting
  const setTimerTvModeOnly = useCallback(async (value: boolean) => {
    if (!externalUser?.id) return;

    // Optimistic update
    setSettings(prev => ({ ...prev, timerTvModeOnly: value }));

    try {
      // Try to upsert the setting
      const { error } = await supabase
        .from('external_user_settings')
        .upsert(
          {
            external_user_id: externalUser.id,
            timer_tv_mode_only: value,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'external_user_id' }
        );

      if (error) {
        console.error('Error saving external user settings:', error);
        // Revert on error
        setSettings(prev => ({ ...prev, timerTvModeOnly: !value }));
      }
    } catch (error) {
      console.error('Error saving external user settings:', error);
      // Revert on error
      setSettings(prev => ({ ...prev, timerTvModeOnly: !value }));
    }
  }, [externalUser?.id]);

  return {
    timerTvModeOnly: settings.timerTvModeOnly,
    isLoading: settings.isLoading,
    setTimerTvModeOnly,
  };
}
