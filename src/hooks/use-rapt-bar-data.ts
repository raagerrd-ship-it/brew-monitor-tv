import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { TempController, PillData } from '@/types/brew';
import { getRaptBar, setRaptBar, useRaptBarStore } from '@/lib/rapt-bar-store';

interface RaptBarData {
  controllers: TempController[];
  pills: PillData[];
  piDisabled: Record<string, boolean>;
  piManual: Record<string, boolean>;
  activeSessions: Record<string, boolean>;
  loading: boolean;
}

// Engångsladdning när ingen use-brew-data fyller den delade källan (t.ex. Inställningar).
async function loadOnce(initial: boolean) {
  const startedAt = Date.now();
...
    if (initial ? getRaptBar().loaded : getRaptBar().updatedAt > startedAt) return;

    const controllers = (controllersRes.data || []).sort((a: any, b: any) =>
      controllerIds.indexOf(a.controller_id) - controllerIds.indexOf(b.controller_id)) as TempController[];
    const pills = (pillsRes.data || []).sort((a: any, b: any) =>
      pillIds.indexOf(a.pill_id) - pillIds.indexOf(b.pill_id)) as PillData[];
    const activeSessions: Record<string, boolean> = {};
    for (const s of sessionsRes.data || []) if (s.controller_id) activeSessions[s.controller_id] = true;
    const piDisabled: Record<string, boolean> = {};
    const piManual: Record<string, boolean> = {};
    for (const c of controllers as any[]) {
      if (c.actuation !== 'pi') continue;
      const ls = (liveRes.data || []).find((l: any) => c.controller_id === l.controller_id || c.controller_id.startsWith(l.controller_id));
      if (ls) { piDisabled[c.controller_id] = ls.enabled === false; piManual[c.controller_id] = ls.target_source === 'manual'; }
    }
    setRaptBar({ controllers, pills, piDisabled, piManual, activeSessions });
  } catch (error) {
    console.error('Error loading RAPT bar data:', error);
  }
}

export function useRaptBarData(): RaptBarData {
  const s = useRaptBarStore();
  useEffect(() => {
    if (!getRaptBar().loaded) loadOnce(true);
    // Utan use-brew-data (t.ex. Inställningar) blir källan inaktuell — hämta om var 60:e s.
    const id = setInterval(() => { if (Date.now() - getRaptBar().updatedAt >= 60_000) loadOnce(false); }, 60_000);
    return () => clearInterval(id);
  }, []);
  return { controllers: s.controllers, pills: s.pills, piDisabled: s.piDisabled, piManual: s.piManual, activeSessions: s.activeSessions, loading: !s.loaded };
}
