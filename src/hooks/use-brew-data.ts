import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase } from '@/integrations/external-supabase/client';
import { useToast } from '@/hooks/use-toast';
import { toast as sonnerToast } from 'sonner';
import { BrewData, BrewEvent, PillData, TempController } from '@/types/brew';
import { calculateFermentationRate, calculateFermentationTrend } from '@/lib/brew-utils';
import { useTvMode } from '@/contexts/TvModeContext';

interface UseBrewDataReturn {
  brews: BrewData[];
  setBrews: React.Dispatch<React.SetStateAction<BrewData[]>>;
  pills: PillData[];
  controllers: TempController[];
  loading: boolean;
  updatedFields: Record<string, Record<string, boolean>>;
  brewEvents: Record<string, BrewEvent[]>;
  isAuthenticated: boolean;
  loadBrews: () => Promise<void>;
  loadRaptData: () => Promise<void>;
  loadBrewEvents: () => Promise<void>;
  // Callbacks for consolidated realtime channels
  onSonosNowPlayingChange: React.MutableRefObject<((payload: any) => void) | null>;
  onSonosSettingsChange: React.MutableRefObject<((payload: any) => void) | null>;
  onCachedTimerChange: React.MutableRefObject<(() => void) | null>;
  onSyncSettingsChange: React.MutableRefObject<((payload: any) => void) | null>;
}

// Preferred color order for sorting brews (matches physical vessel order)
const COLOR_SORT_ORDER = ['gul', 'gyllene', 'guld', 'golden', 'yellow', 'blå', 'blue', 'grön', 'green'];

function getColorSortIndex(name: string): number {
  const lower = name.toLowerCase();
  for (let i = 0; i < COLOR_SORT_ORDER.length; i++) {
    if (lower.includes(COLOR_SORT_ORDER[i])) {
      // Map to group index: gul-variants=0, blå-variants=1, grön-variants=2
      if (i <= 4) return 0; // gul/gyllene/guld/golden/yellow
      if (i <= 6) return 1; // blå/blue
      return 2;             // grön/green
    }
  }
  return 99; // No color match — sort last
}

// Helper function to sort brews by color order (Gul, Blå, Grön)
function sortBrewsByControllers(brews: BrewData[], controllers: TempController[]): BrewData[] {
  if (brews.length === 0) return brews;
  
  return [...brews].sort((a, b) => {
    const aColor = getColorSortIndex(a.name);
    const bColor = getColorSortIndex(b.name);
    return aColor - bColor;
  });
}

export function useBrewData(): UseBrewDataReturn {
  const [brews, setBrews] = useState<BrewData[]>([]);
  const [pills, setPills] = useState<PillData[]>([]);
  const [controllers, setControllers] = useState<TempController[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatedFields, setUpdatedFields] = useState<Record<string, Record<string, boolean>>>({});
  const [brewEvents, setBrewEvents] = useState<Record<string, BrewEvent[]>>({});
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const { toast } = useToast();
  const { isTvMode } = useTvMode();

  // Ref for realtime comparison
  const brewsRef = useRef<BrewData[]>([]);
  const controllersRef = useRef<TempController[]>([]);
  
  // Callback refs for consolidated realtime channels
  const onSonosNowPlayingChange = useRef<((payload: any) => void) | null>(null);
  const onSonosSettingsChange = useRef<((payload: any) => void) | null>(null);
  const onCachedTimerChange = useRef<(() => void) | null>(null);
  const onSyncSettingsChange = useRef<((payload: any) => void) | null>(null);
  
  useEffect(() => {
    brewsRef.current = brews;
  }, [brews]);
  
  useEffect(() => {
    controllersRef.current = controllers;
  }, [controllers]);

  // Auth state — check both Lovable Cloud and external Supabase
  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session: cloudSession } } = await supabase.auth.getSession();
      const { data: { session: extSession } } = await externalSupabase.auth.getSession();
      setIsAuthenticated(!!cloudSession || !!extSession);
    };
    checkAuth();

    const { data: { subscription: cloudSub } } = supabase.auth.onAuthStateChange((_, session) => {
      if (session) setIsAuthenticated(true);
      else externalSupabase.auth.getSession().then(({ data: { session: ext } }) => setIsAuthenticated(!!ext));
    });

    const { data: { subscription: extSub } } = externalSupabase.auth.onAuthStateChange((_, session) => {
      if (session) setIsAuthenticated(true);
      else supabase.auth.getSession().then(({ data: { session: cloud } }) => setIsAuthenticated(!!cloud));
    });

    return () => {
      cloudSub.unsubscribe();
      extSub.unsubscribe();
    };
  }, []);

  const loadBrewEvents = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('brew_events')
        .select('*')
        .order('event_date');

      if (error) throw error;

      const eventsByBrew: Record<string, BrewEvent[]> = {};
      (data || []).forEach((event: BrewEvent) => {
        if (!eventsByBrew[event.brew_id]) {
          eventsByBrew[event.brew_id] = [];
        }
        eventsByBrew[event.brew_id].push(event);
      });

      setBrewEvents(eventsByBrew);
    } catch (error) {
      console.error('Error loading brew events:', error);
    }
  }, []);

  // Internal function to load brews data (returns data instead of setting state)
  const loadBrewsInternal = useCallback(async (): Promise<BrewData[]> => {
    const { data: selectedBrews, error: selectedError } = await supabase
      .from('selected_brews')
      .select('batch_id')
      .eq('is_visible', true)
      .order('display_order');

    if (selectedError) throw selectedError;

    if (!selectedBrews || selectedBrews.length === 0) {
      return [];
    }

    const selectedBatchIds = selectedBrews.map(sb => sb.batch_id);

    const [brewReadingsRes, eventsRes, sessionsRes, metricsRes] = await Promise.all([
      supabase
        .from('brew_readings')
        .select('*')
        .in('batch_id', selectedBatchIds)
        .order('created_at', { ascending: false }),
      supabase
        .from('brew_events')
        .select('*')
        .order('event_date'),
      supabase
        .from('fermentation_sessions')
        .select('*')
        .in('status', ['running', 'paused', 'completed']),
      supabase
        .from('brew_fermentation_metrics')
        .select('*'),
    ]);

    if (brewReadingsRes.error) throw brewReadingsRes.error;

    // Build metrics map by brew_id
    const metricsMap = new Map<string, any>();
    (metricsRes.data || []).forEach((m: any) => {
      metricsMap.set(m.brew_id, m);
    });

    const brewReadings = brewReadingsRes.data;
    if (!brewReadings || brewReadings.length === 0) {
      return [];
    }

    // Get linked pill IDs for custom brews to fetch their last_update
    const linkedPillIds = brewReadings
      .filter((r: any) => r.linked_pill_id)
      .map((r: any) => r.linked_pill_id);
    
    // Fetch pill data for linked pills (to get last_update for custom brews)
    const pillsMap = new Map<string, { last_update: string | null }>();
    if (linkedPillIds.length > 0) {
      const { data: pillsData } = await supabase
        .from('rapt_pills')
        .select('pill_id, last_update')
        .in('pill_id', linkedPillIds);
      
      (pillsData || []).forEach((pill: any) => {
        pillsMap.set(pill.pill_id, { last_update: pill.last_update });
      });
    }

    // Fetch profiles and steps for active sessions
    const activeSessions = sessionsRes.data || [];
    const profileIds = [...new Set(activeSessions.map(s => s.profile_id))];
    const sessionControllerIds = [...new Set(activeSessions.map(s => s.controller_id))];
    
    const [profilesRes, stepsRes, sessionControllersRes] = await Promise.all([
      profileIds.length > 0 
        ? supabase.from('fermentation_profiles').select('*').in('id', profileIds)
        : Promise.resolve({ data: [] }),
      profileIds.length > 0 
        ? supabase.from('fermentation_profile_steps').select('*').in('profile_id', profileIds).order('step_order')
        : Promise.resolve({ data: [] }),
      sessionControllerIds.length > 0
        ? supabase.from('rapt_temp_controllers').select('controller_id, current_temp, target_temp, profile_target_temp').in('controller_id', sessionControllerIds)
        : Promise.resolve({ data: [] }),
    ]);

    const profilesMap = new Map((profilesRes.data || []).map((p: any) => [p.id, p]));
    const stepsMap = new Map<string, any[]>();
    (stepsRes.data || []).forEach((s: any) => {
      if (!stepsMap.has(s.profile_id)) stepsMap.set(s.profile_id, []);
      stepsMap.get(s.profile_id)!.push(s);
    });
    const sessionControllersMap = new Map((sessionControllersRes.data || []).map((c: any) => [c.controller_id, c]));

    // Build session data by brew_id
    const sessionsByBrewId = new Map<string, any>();
    activeSessions.forEach(session => {
      if (session.brew_id) {
        const profile = profilesMap.get(session.profile_id);
        const steps = stepsMap.get(session.profile_id) || [];
        const controller = sessionControllersMap.get(session.controller_id);
        sessionsByBrewId.set(session.brew_id, {
          id: session.id,
          profile_id: session.profile_id,
          controller_id: session.controller_id,
          status: session.status,
          current_step_index: session.current_step_index,
          step_started_at: session.step_started_at,
          started_at: session.started_at,
          step_start_temp: session.step_start_temp,
          profile_name: profile?.name || '',
          steps: steps.map((s: any) => ({
            id: s.id,
            step_type: s.step_type,
            target_temp: s.target_temp,
            duration_hours: s.duration_hours,
            ramp_type: s.ramp_type,
            gravity_stable_days: s.gravity_stable_days,
            target_sg: s.target_sg,
            sg_comparison: s.sg_comparison,
            step_order: s.step_order,
            attenuation_trigger: s.attenuation_trigger,
            activity_trigger: s.activity_trigger,
            temp_increase: s.temp_increase,
            gravity_threshold: s.gravity_threshold,
          })),
          controller_current_temp: controller?.current_temp ?? null,
          controller_target_temp: controller?.target_temp ?? null,
          controller_profile_target_temp: controller?.profile_target_temp ?? null,
        });
      }
    });

    // Group events by brew_id
    const eventsByBrewId: Record<string, BrewEvent[]> = {};
    (eventsRes.data || []).forEach((event: BrewEvent) => {
      if (!eventsByBrewId[event.brew_id]) {
        eventsByBrewId[event.brew_id] = [];
      }
      eventsByBrewId[event.brew_id].push(event);
    });

    // Batch-fetch recent overshoot adjustments for all linked controllers
    const allControllerIds = brewReadings
      .filter((r: any) => r.linked_controller_id)
      .map((r: any) => r.linked_controller_id);
    
    const overshootMap = new Map<string, { reason: string | null; original_target: number | null }>();
    if (allControllerIds.length > 0) {
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
      const { data: adjData } = await supabase
        .from('auto_cooling_adjustments')
        .select('reason, created_at, original_target_temp, cooler_controller_id, followed_controller_id')
        .or(allControllerIds.map((id: string) => `followed_controller_id.eq.${id},cooler_controller_id.eq.${id}`).join(','))
        .like('reason', '🌡️%')
        .order('created_at', { ascending: false });
      
      // For each controller, find the most recent overshoot adjustment
      const uniqueIds = [...new Set(allControllerIds)] as string[];
      for (const cid of uniqueIds) {
        const match = (adjData || []).find((a: any) => 
          a.followed_controller_id === cid || a.cooler_controller_id === cid
        );
        if (match) {
          const age = Date.now() - new Date(match.created_at).getTime();
          overshootMap.set(cid, {
            reason: age < 6 * 60 * 60 * 1000 ? match.reason.replace('🌡️ ', '') : null,
            original_target: match.original_target_temp ?? null,
          });
        }
      }
    }

    return brewReadings.map((reading: any) => {
      const originalSgData = reading.sg_data || [];
      let sgData = originalSgData;

      if (reading.status === 'Conditioning' || reading.status === 'Completed') {
        const sortedData = [...sgData].sort((a, b) =>
          new Date(a.date).getTime() - new Date(b.date).getTime()
        );

        let cutoffIndex = sortedData.length - 1;
        for (let i = sortedData.length - 1; i > 0; i--) {
          const recentData = sortedData.slice(Math.max(0, i - 10), i + 1);
          const rate = calculateFermentationRate(recentData);

          if (rate !== null && Math.abs(rate) >= 0.001) {
            cutoffIndex = i;
            break;
          }
        }

        sgData = sortedData.slice(0, cutoffIndex + 1);
      }

      const fermentationRate = calculateFermentationRate(originalSgData);
      const fermentationTrend = calculateFermentationTrend(originalSgData);

      // For custom brews (with linked_pill_id), use pill's last_update if brew has no last_update
      let effectiveLastUpdate = reading.last_update;
      if (!effectiveLastUpdate && reading.linked_pill_id) {
        const linkedPill = pillsMap.get(reading.linked_pill_id);
        if (linkedPill?.last_update) {
          effectiveLastUpdate = linkedPill.last_update;
        }
      }

      return {
        id: reading.id,
        batch_id: reading.batch_id,
        share_id: reading.share_id || null,
        name: reading.name,
        style: reading.style,
        batchNumber: reading.batch_number,
        status: reading.status,
        currentSG: reading.current_sg,
        currentTemp: reading.current_temp,
        attenuation: reading.attenuation,
        abv: reading.abv,
        originalGravity: reading.original_gravity,
        finalGravity: reading.final_gravity,
        lastUpdate: effectiveLastUpdate
          ? new Date(effectiveLastUpdate).toLocaleString('sv-SE', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'Ingen data',
        lastUpdateRaw: effectiveLastUpdate,
        battery: reading.battery,
        sgData: sgData,
        fermentationRate:
          reading.status === 'Conditioning' || reading.status === 'Completed'
            ? 0
            : fermentationRate,
        coldcrashAcknowledged: reading.coldcrash_acknowledged ?? false,
        events: eventsByBrewId[reading.id] || [],
        linked_controller_id: reading.linked_controller_id || null,
        linked_pill_id: reading.linked_pill_id || null,
        fermentationSession: sessionsByBrewId.get(reading.id) || null,
        label_image_url: reading.label_image_url || null,
        description: reading.description || null,
        overshootReason: reading.linked_controller_id 
          ? overshootMap.get(reading.linked_controller_id)?.reason ?? null 
          : null,
        originalTarget: reading.linked_controller_id 
          ? overshootMap.get(reading.linked_controller_id)?.original_target ?? null 
          : null,
        fermentationTrend,
        fermentationMetrics: (() => {
          const m = metricsMap.get(reading.id);
          if (!m) return null;
          return {
            fermentation_phase: m.fermentation_phase,
            activity_score: Number(m.activity_score),
            sg_rate_per_hour: Number(m.sg_rate_per_hour),
            eta_to_fg_hours: m.eta_to_fg_hours != null ? Number(m.eta_to_fg_hours) : null,
            peak_delta: Number(m.peak_delta),
            ready_to_crash: m.ready_to_crash,
          };
        })(),
      };
    });
  }, []);

  // Internal function to load RAPT data (returns data instead of setting state)
  const loadRaptDataInternal = useCallback(async (): Promise<{ pills: PillData[], controllers: TempController[] }> => {
    // Direct parallel queries instead of edge function
    const [selectedControllersRes, selectedPillsRes] = await Promise.all([
      supabase.from('selected_rapt_temp_controllers').select('controller_id').eq('is_visible', true).order('display_order'),
      supabase.from('selected_rapt_pills').select('pill_id').eq('is_visible', true).order('display_order'),
    ]);
    
    const controllerIds = selectedControllersRes.data?.map(s => s.controller_id) || [];
    const pillIds = selectedPillsRes.data?.map(s => s.pill_id) || [];
    
    const [controllersRes, pillsRes] = await Promise.all([
      controllerIds.length > 0 
        ? supabase.from('rapt_temp_controllers').select('*').in('controller_id', controllerIds)
        : Promise.resolve({ data: [] }),
      pillIds.length > 0
        ? supabase.from('rapt_pills').select('*').in('pill_id', pillIds) 
        : Promise.resolve({ data: [] }),
    ]);
    
    // Sort by display_order
    const sortedControllers = (controllersRes.data || []).sort((a, b) => 
      controllerIds.indexOf(a.controller_id) - controllerIds.indexOf(b.controller_id)
    ) as TempController[];
    
    const sortedPills = (pillsRes.data || []).sort((a, b) =>
      pillIds.indexOf(a.pill_id) - pillIds.indexOf(b.pill_id)
    ) as PillData[];
    
    return { pills: sortedPills, controllers: sortedControllers };
  }, []);

  // Load all data in parallel and sort brews BEFORE setting state
  const loadAllData = useCallback(async () => {
    try {
      setLoading(true);
      
      // Load ALL data in parallel
      const [brewsData, raptData] = await Promise.all([
        loadBrewsInternal(),
        loadRaptDataInternal(),
      ]);
      
      // Sort brews by controllers BEFORE setting state (no visual reordering)
      const sortedBrews = sortBrewsByControllers(brewsData, raptData.controllers);
      
      // Update all state at once
      setBrews(sortedBrews);
      setPills(raptData.pills);
      setControllers(raptData.controllers);
    } catch (error) {
      console.error('Error loading data:', error);
      toast({
        title: 'Fel',
        description: 'Kunde inte ladda data',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [loadBrewsInternal, loadRaptDataInternal, toast]);

  // Public loadBrews for external use and realtime updates
  const loadBrews = useCallback(async () => {
    try {
      const brewsData = await loadBrewsInternal();
      // Sort using current controllers from ref
      const sortedBrews = sortBrewsByControllers(brewsData, controllersRef.current);
      setBrews(sortedBrews);
    } catch (error) {
      console.error('Error loading brews:', error);
      toast({
        title: 'Fel',
        description: 'Kunde inte ladda bryggdata',
        variant: 'destructive',
      });
    }
  }, [loadBrewsInternal, toast]);

  // Public loadRaptData for external use and realtime updates
  const loadRaptData = useCallback(async () => {
    try {
      const raptData = await loadRaptDataInternal();
      setPills(raptData.pills);
      setControllers(raptData.controllers);
      
      // Re-sort brews with new controllers
      setBrews(prev => sortBrewsByControllers(prev, raptData.controllers));
    } catch (error) {
      console.error('Error loading RAPT data:', error);
    }
  }, [loadRaptDataInternal]);

  // Handle brew reading updates - direct state update
  const handleBrewUpdate = useCallback((payload: any) => {
    if (payload.eventType === 'UPDATE' && payload.new) {
      const updatedReading = payload.new;
      const currentBrew = brewsRef.current.find(b => b.batch_id === updatedReading.batch_id);

      if (!currentBrew) {
        loadBrews();
        return;
      }

      // Track changed fields for glow effect
      const changedFields: Record<string, boolean> = {};

      if (updatedReading.current_sg !== undefined) {
        const newSGRounded = Number(updatedReading.current_sg.toFixed(3));
        const screenSGRounded = Number(currentBrew.currentSG.toFixed(3));
        if (newSGRounded !== screenSGRounded) changedFields.sg = true;
      }

      if (updatedReading.current_temp !== undefined) {
        const newTempRounded = Number(updatedReading.current_temp.toFixed(1));
        const screenTempRounded = Number(currentBrew.currentTemp.toFixed(1));
        if (newTempRounded !== screenTempRounded) changedFields.temp = true;
      }

      if (updatedReading.attenuation !== undefined) {
        if (Math.round(updatedReading.attenuation) !== Math.round(currentBrew.attenuation)) {
          changedFields.attenuation = true;
        }
      }

      if (updatedReading.abv !== undefined) {
        const newABVRounded = Number(updatedReading.abv.toFixed(1));
        const screenABVRounded = Number(currentBrew.abv.toFixed(1));
        if (newABVRounded !== screenABVRounded) changedFields.abv = true;
      }

      if (
        updatedReading.battery !== undefined &&
        updatedReading.battery !== null &&
        currentBrew.battery !== null
      ) {
        if (Math.round(updatedReading.battery) !== Math.round(currentBrew.battery)) {
          changedFields.battery = true;
        }
      }


      setBrews(prevBrews =>
        prevBrews.map(brew => {
          if (brew.batch_id === updatedReading.batch_id) {
            const originalSgData = updatedReading.sg_data || [];
            let newSgData = originalSgData;

            if (
              updatedReading.status === 'Conditioning' ||
              updatedReading.status === 'Completed'
            ) {
              const sortedData = [...newSgData].sort(
                (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
              );

              let cutoffIndex = sortedData.length - 1;
              for (let i = sortedData.length - 1; i > 0; i--) {
                const recentData = sortedData.slice(Math.max(0, i - 10), i + 1);
                const rate = calculateFermentationRate(recentData);

                if (rate !== null && Math.abs(rate) >= 0.001) {
                  cutoffIndex = i;
                  break;
                }
              }

              newSgData = sortedData.slice(0, cutoffIndex + 1);
            }

            const newFermentationRate = calculateFermentationRate(originalSgData);

            return {
              ...brew,
              status: updatedReading.status ?? brew.status,
              currentSG: updatedReading.current_sg,
              currentTemp: updatedReading.current_temp,
              attenuation: updatedReading.attenuation,
              abv: updatedReading.abv,
              battery: updatedReading.battery,
              lastUpdate: updatedReading.last_update
                ? new Date(updatedReading.last_update).toLocaleString('sv-SE', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : 'Ingen data',
              lastUpdateRaw: updatedReading.last_update,
              sgData: newSgData,
              fermentationRate:
                (updatedReading.status ?? brew.status) === 'Conditioning' ||
                (updatedReading.status ?? brew.status) === 'Completed'
                  ? 0
                  : newFermentationRate,
              coldcrashAcknowledged:
                updatedReading.coldcrash_acknowledged ?? brew.coldcrashAcknowledged,
            };
          }
          return brew;
        })
      );

      // Skip glow effects in TV mode to save memory (no timers)
      if (Object.keys(changedFields).length > 0 && !isTvMode) {
        setUpdatedFields(prev => ({
          ...prev,
          [updatedReading.batch_id]: changedFields,
        }));

        setTimeout(() => {
          setUpdatedFields(prev => {
            const newFields = { ...prev };
            delete newFields[updatedReading.batch_id];
            return newFields;
          });
        }, 120000);
      }
    } else {
      loadBrews();
    }
  }, [loadBrews]);

  // Optimized realtime handlers - update in-place where possible
  const handlePillUpdate = useCallback((payload: any) => {
    if (payload.eventType === 'UPDATE' && payload.new) {
      setPills(prev => prev.map(pill => 
        pill.pill_id === payload.new.pill_id ? { ...pill, ...payload.new } : pill
      ));
    } else {
      loadRaptData();
    }
  }, [loadRaptData]);

  const handleControllerUpdate = useCallback((payload: any) => {
    if (payload.eventType === 'UPDATE' && payload.new) {
      setControllers(prev => prev.map(controller => 
        controller.controller_id === payload.new.controller_id 
          ? { ...controller, ...payload.new } 
          : controller
      ));
    } else {
      loadRaptData();
    }
  }, [loadRaptData]);

  // Consolidated realtime: 2 channels instead of 7
  // Channel 1: Data updates (need payload for in-place state updates)
  useEffect(() => {
    const batchRef = { pending: new Map<string, any>(), timer: null as NodeJS.Timeout | null };

    const dispatch = (table: string, payload: any) => {
      if (isTvMode) {
        batchRef.pending.set(table, payload);
        if (!batchRef.timer) {
          batchRef.timer = setTimeout(() => {
            const entries = new Map(batchRef.pending);
            batchRef.pending.clear();
            batchRef.timer = null;
            entries.forEach((p, t) => {
              if (t === 'brew_readings') handleBrewUpdate(p);
              else if (t === 'rapt_pills') handlePillUpdate(p);
              else if (t === 'rapt_temp_controllers') handleControllerUpdate(p);
            });
          }, 2000);
        }
      } else {
        if (table === 'brew_readings') handleBrewUpdate(payload);
        else if (table === 'rapt_pills') handlePillUpdate(payload);
        else if (table === 'rapt_temp_controllers') handleControllerUpdate(payload);
      }
    };

    const channel = supabase
      .channel(`data-updates-${Date.now()}`)
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'brew_readings' }, (p: any) => dispatch('brew_readings', p))
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'rapt_pills' }, (p: any) => dispatch('rapt_pills', p))
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'rapt_temp_controllers' }, (p: any) => dispatch('rapt_temp_controllers', p))
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'sonos_now_playing' }, (p: any) => {
        onSonosNowPlayingChange.current?.(p);
      })
      .on('postgres_changes' as any, { event: 'UPDATE', schema: 'public', table: 'sonos_settings' }, (p: any) => {
        onSonosSettingsChange.current?.(p);
      })
      .subscribe();

    return () => {
      if (batchRef.timer) clearTimeout(batchRef.timer);
      supabase.removeChannel(channel);
    };
  }, [handleBrewUpdate, handlePillUpdate, handleControllerUpdate, isTvMode]);

  // Channel 2: Config/session changes (just trigger reload, no payload needed)
  useEffect(() => {


    const handleConfigChange = (table: string) => {
      if (table === 'selected_brews') {
        sonnerToast('Inställningar uppdaterade', { description: 'Öllistan har ändrats från en annan enhet', duration: 5000 });
        loadBrews();
      } else if (table === 'selected_rapt_pills') {
        sonnerToast('Inställningar uppdaterade', { description: 'RAPT Pill-listan har ändrats från en annan enhet', duration: 5000 });
        loadRaptData();
      } else if (table === 'selected_rapt_temp_controllers') {
        sonnerToast('Inställningar uppdaterade', { description: 'RAPT-kontrollerlistan har ändrats från en annan enhet', duration: 5000 });
        loadRaptData();
      } else if (table === 'fermentation_sessions') {
        loadBrews();
      }
    };

    const channel = supabase
      .channel(`config-updates-${Date.now()}`)
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'selected_brews' }, () => handleConfigChange('selected_brews'))
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'selected_rapt_pills' }, () => handleConfigChange('selected_rapt_pills'))
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'selected_rapt_temp_controllers' }, () => handleConfigChange('selected_rapt_temp_controllers'))
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'fermentation_sessions' }, () => handleConfigChange('fermentation_sessions'))
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'cached_external_timer' }, () => {
        onCachedTimerChange.current?.();
      })
      .on('postgres_changes' as any, { event: 'UPDATE', schema: 'public', table: 'sync_settings' }, (p: any) => {
        onSyncSettingsChange.current?.(p);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadBrews, loadRaptData]);

  // Initial data load - single parallel load
  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  // TV mode: polling fallback for fermentation session changes
  // Realtime can silently drop on Chromecast hardware, so poll every 60s
  useEffect(() => {
    if (!isTvMode) return;

    const lastSessionHash = { current: '' };

    const checkSessions = async () => {
      try {
        const { data } = await supabase
          .from('fermentation_sessions')
          .select('id, current_step_index, status, updated_at')
          .in('status', ['running', 'paused', 'completed']);

        const hash = JSON.stringify(data || []);
        if (hash !== lastSessionHash.current) {
          if (lastSessionHash.current !== '') {
            // Session changed — reload brews to get updated preloadedSession
            console.log('[TV] Fermentation session change detected via polling, reloading...');
            loadBrews();
          }
          lastSessionHash.current = hash;
        }
      } catch (e) {
        console.error('[TV] Fermentation poll error:', e);
      }
    };

    // Initial hash capture
    checkSessions();

    const intervalId = setInterval(checkSessions, 300_000); // 5 minutes
    return () => clearInterval(intervalId);
  }, [isTvMode, loadBrews]);

  return {
    brews,
    setBrews,
    pills,
    controllers,
    loading,
    updatedFields,
    brewEvents,
    isAuthenticated,
    loadBrews,
    loadRaptData,
    loadBrewEvents,
    onSonosNowPlayingChange,
    onSonosSettingsChange,
    onCachedTimerChange,
    onSyncSettingsChange,
  };
}
