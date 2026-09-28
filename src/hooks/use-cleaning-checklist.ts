import { useCallback, useSyncExternalStore } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { subscribeSyncSettings } from '@/lib/sync-settings-store';

export type CleaningChecklistView = 'brewhouse' | 'vessels' | null;

/**
 * Shared cleaning-checklist state: toggled from phone/desktop, mirrored on TV.
 * Stored in sync_settings.cleaning_checklist (realtime enabled on that table).
 * One module-level store so the menu and the overlay always show the same view.
 */
let view: CleaningChecklistView = null;
const listeners = new Set<() => void>();

const setView = (next: CleaningChecklistView) => {
  if (view === next) return;
  view = next;
  listeners.forEach((l) => l());
};

let started = false;
const start = () => {
  if (started) return;
  started = true;
  subscribeSyncSettings((row) => setView((row.cleaning_checklist as CleaningChecklistView) ?? null));
};

export function useCleaningChecklist() {
  const current = useSyncExternalStore(
    (onChange) => {
      start();
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => view
  );

  const setChecklist = useCallback(async (next: CleaningChecklistView) => {
    setView(next);
    await supabase
      .from('sync_settings')
      .update({ cleaning_checklist: next })
      .not('id', 'is', null);
  }, []);

  return { view: current, setChecklist };
}
