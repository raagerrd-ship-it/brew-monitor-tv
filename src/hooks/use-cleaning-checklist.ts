import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type CleaningChecklistView = 'brewhouse' | 'vessels' | null;

/**
 * Shared cleaning-checklist state: toggled from phone/desktop, mirrored on TV.
 * Stored in sync_settings.cleaning_checklist (realtime enabled on that table).
 */
export function useCleaningChecklist() {
  const [view, setView] = useState<CleaningChecklistView>(null);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      const { data } = await supabase
        .from('sync_settings')
        .select('cleaning_checklist')
        .limit(1)
        .maybeSingle();
      if (mounted) setView((data?.cleaning_checklist as CleaningChecklistView) ?? null);
    };
    load();

    const channel = supabase
      .channel(`cleaning-checklist-${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes' as any,
        { event: 'UPDATE', schema: 'public', table: 'sync_settings' },
        (payload: any) => {
          setView((payload.new?.cleaning_checklist as CleaningChecklistView) ?? null);
        }
      )
      .subscribe();

    const poll = setInterval(load, 30000);

    return () => {
      mounted = false;
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, []);

  const setChecklist = useCallback(async (next: CleaningChecklistView) => {
    setView(next);
    await supabase
      .from('sync_settings')
      .update({ cleaning_checklist: next })
      .not('id', 'is', null);
  }, []);

  return { view, setChecklist };
}
