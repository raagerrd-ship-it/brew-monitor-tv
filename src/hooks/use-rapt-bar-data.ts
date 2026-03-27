import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { TempController, PillData } from '@/types/brew';

interface RaptBarData {
  controllers: TempController[];
  pills: PillData[];
  loading: boolean;
}

export function useRaptBarData(): RaptBarData {
  const [controllers, setControllers] = useState<TempController[]>([]);
  const [pills, setPills] = useState<PillData[]>([]);
  const [loading, setLoading] = useState(true);
  const controllerIdsRef = useRef<string[]>([]);
  const pillIdsRef = useRef<string[]>([]);

  const loadData = useCallback(async () => {
    try {
      const [selectedControllersRes, selectedPillsRes] = await Promise.all([
        supabase.from('selected_rapt_temp_controllers').select('controller_id').eq('is_visible', true).order('display_order'),
        supabase.from('selected_rapt_pills').select('pill_id').eq('is_visible', true).order('display_order'),
      ]);

      const controllerIds = selectedControllersRes.data?.map(s => s.controller_id) || [];
      const pillIds = selectedPillsRes.data?.map(s => s.pill_id) || [];
      controllerIdsRef.current = controllerIds;
      pillIdsRef.current = pillIds;

      const [controllersRes, pillsRes] = await Promise.all([
        controllerIds.length > 0
          ? supabase.from('rapt_temp_controllers').select('*').in('controller_id', controllerIds)
          : Promise.resolve({ data: [] as any[] }),
        pillIds.length > 0
          ? supabase.from('rapt_pills').select('*').in('pill_id', pillIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const sortedControllers = (controllersRes.data || []).sort((a: any, b: any) =>
        controllerIds.indexOf(a.controller_id) - controllerIds.indexOf(b.controller_id)
      ) as TempController[];

      const sortedPills = (pillsRes.data || []).sort((a: any, b: any) =>
        pillIds.indexOf(a.pill_id) - pillIds.indexOf(b.pill_id)
      ) as PillData[];

      setControllers(sortedControllers);
      setPills(sortedPills);
    } catch (error) {
      console.error('Error loading RAPT bar data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();

    // Realtime: controller updates
    const channel = supabase
      .channel('rapt-bar-data')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rapt_temp_controllers' }, (payload) => {
        if (payload.eventType === 'UPDATE' && payload.new) {
          const updated = payload.new as any;
          setControllers(prev => {
            const idx = prev.findIndex(c => c.controller_id === updated.controller_id);
            if (idx === -1) return prev;
            const next = [...prev];
            next[idx] = { ...next[idx], ...updated } as TempController;
            return next;
          });
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rapt_pills' }, (payload) => {
        if (payload.eventType === 'UPDATE' && payload.new) {
          const updated = payload.new as any;
          setPills(prev => {
            const idx = prev.findIndex(p => p.pill_id === updated.pill_id);
            if (idx === -1) return prev;
            const next = [...prev];
            next[idx] = { ...next[idx], ...updated } as PillData;
            return next;
          });
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'selected_rapt_temp_controllers' }, () => {
        loadData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'selected_rapt_pills' }, () => {
        loadData();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [loadData]);

  return { controllers, pills, loading };
}
