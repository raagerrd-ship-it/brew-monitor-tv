import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useToast } from "@/hooks/use-toast";
import { TempController } from "@/types/brew";
import { User } from "@supabase/supabase-js";

interface AvailableController {
  id: string;
  controller_id: string;
  name: string;
  current_temp: number | null;
  pill_temp: number | null;
  actual_temp: number | null;
  target_temp: number | null;
  profile_target_temp: number | null;
  cooling_enabled: boolean | null;
  heating_enabled: boolean | null;
  cooling_hysteresis: number | null;
  linked_pill_id: string | null;
  is_glycol_cooler: boolean;
  last_update: string | null;
}

interface ApiSettings {
  rapt: { username: string; apiSecret: string; configured: boolean };
}

interface SyncStep {
  id: string;
  label: string;
  completed: boolean;
  inProgress: boolean;
}

export function useSettingsData() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Sync settings — unified 2-tier model
  const [quickSyncInterval, setQuickSyncInterval] = useState<string>("300");
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [autoHideCompleted, setAutoHideCompleted] = useState(true);
  const [autoHideConditioning, setAutoHideConditioning] = useState(true);
  const [autoHideArchived, setAutoHideArchived] = useState(true);
  const [autoActivateFermenting, setAutoActivateFermenting] = useState(true);
  
  const [fullSyncInterval, setFullSyncInterval] = useState<string>("21600");
  const [splashDelayMs, setSplashDelayMs] = useState<string>("1000");
  const [pillStaleThresholdMin, setPillStaleThresholdMin] = useState<string>("5");
  const [probeStaleThresholdMin, setProbeStaleThresholdMin] = useState<string>("31");
  const [lastFullSync, setLastFullSync] = useState<string | null>(null);
  const [lastQuickSync, setLastQuickSync] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [quickSyncing, setQuickSyncing] = useState(false);
  const [syncSteps, setSyncSteps] = useState<SyncStep[]>([]);
  const [apiSettings, setApiSettings] = useState<ApiSettings | null>(null);

  // Cooler/followed controllers — derived from rapt_temp_controllers.is_glycol_cooler
  const [coolerControllerId, setCoolerControllerId] = useState<string>("");
  const [followedControllerIds, setFollowedControllerIds] = useState<string[]>([]);

  // Controllers & devices
  const [availableControllers, setAvailableControllers] = useState<AvailableController[]>([]);
  const [visiblePillsCount, setVisiblePillsCount] = useState(0);
  const [visibleControllersCount, setVisibleControllersCount] = useState(0);
  const [visibleBrewsCount, setVisibleBrewsCount] = useState(0);
  const [headerPillsData, setHeaderPillsData] = useState<Array<{
    pill_id: string; color: string; name: string; battery_level: number; last_update: string | null;
  }>>([]);
  const [externalLoginDialogOpen, setExternalLoginDialogOpen] = useState(false);

  // Convert availableControllers to TempController[] for the header
  const headerControllers: TempController[] = useMemo(() => 
    availableControllers.map(c => ({
      id: c.id,
      controller_id: c.controller_id,
      name: c.name,
      current_temp: c.current_temp,
      pill_temp: c.pill_temp,
      target_temp: c.target_temp,
      last_update: c.last_update,
      min_target_temp: null,
      max_target_temp: null,
      cooling_enabled: c.cooling_enabled,
      heating_enabled: null,
      heating_utilisation: null,
      linked_pill_id: c.linked_pill_id,
      cooling_hysteresis: null,
      heating_hysteresis: null,
      cooling_run_time: null,
      cooling_starts: null,
      heating_run_time: null,
      heating_starts: null,
      is_glycol_cooler: c.is_glycol_cooler,
      actual_temp: (c as any).actual_temp ?? null,
      dual_sensor_enabled: (c as any).dual_sensor_enabled ?? false,
      preferred_sensor: (c as any).preferred_sensor ?? 'pill',
      profile_target_temp: (c as any).profile_target_temp ?? null,
    })),
    [availableControllers]
  );

  // Auto-derive cooler and followed controllers
  useEffect(() => {
    const cooler = availableControllers.find(c => c.is_glycol_cooler);
    setCoolerControllerId(cooler?.id || "");
    const followed = availableControllers
      .filter(c => !c.is_glycol_cooler && (c.cooling_enabled || c.heating_enabled))
      .map(c => c.id);
    setFollowedControllerIds(followed);
  }, [availableControllers]);

  // ─── Data loading ───

  const loadSettings = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('sync_settings').select('*').limit(1).maybeSingle();
      if (error) throw error;
      if (data) {
        setSettingsId(data.id);
        // Use rapt_sync_interval as the unified quick_sync_interval
        setQuickSyncInterval(data.rapt_sync_interval?.toString() ?? "300");
        setAutoHideCompleted(data.auto_hide_completed ?? true);
        setAutoHideConditioning(data.auto_hide_conditioning ?? true);
        setAutoHideArchived(data.auto_hide_archived ?? true);
        setAutoActivateFermenting(data.auto_activate_fermenting ?? true);
        
        setFullSyncInterval(data.full_sync_interval?.toString() ?? "21600");
        setSplashDelayMs(data.splash_delay_ms?.toString() ?? "1000");
        setPillStaleThresholdMin(((data as any).pill_stale_threshold_min ?? 5).toString());
        setProbeStaleThresholdMin(((data as any).probe_stale_threshold_min ?? 31).toString());
        setLastFullSync(data.last_full_sync_at);
        setLastQuickSync(data.last_rapt_quick_sync_at);
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }, []);

  const loadApiSettings = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke('get-api-settings');
      if (error) throw error;
      setApiSettings(data);
    } catch (error) {
      console.error('Error loading API settings:', error);
    }
  }, []);

  const loadAvailableControllers = useCallback(async () => {
    try {
      const { data: selected } = await supabase.from('selected_rapt_temp_controllers').select('controller_id, display_order').eq('is_visible', true).order('display_order');
      if (selected && selected.length > 0) {
        const controllerIds = selected.map(s => s.controller_id);
        const orderMap = new Map(selected.map(s => [s.controller_id, s.display_order]));
        const { data: controllers } = await supabase.from('rapt_temp_controllers')
          .select('controller_id, name, current_temp, pill_temp, target_temp, profile_target_temp, cooling_enabled, heating_enabled, cooling_hysteresis, linked_pill_id, is_glycol_cooler, last_update, actual_temp, dual_sensor_enabled, preferred_sensor')
          .in('controller_id', controllerIds);
        if (controllers) {
          const mapped = controllers.map(c => ({
            id: c.controller_id, controller_id: c.controller_id, name: c.name,
            current_temp: c.current_temp, pill_temp: c.pill_temp, target_temp: c.target_temp,
            profile_target_temp: c.profile_target_temp,
            cooling_enabled: c.cooling_enabled, heating_enabled: c.heating_enabled,
            cooling_hysteresis: c.cooling_hysteresis, linked_pill_id: c.linked_pill_id,
            is_glycol_cooler: c.is_glycol_cooler ?? false,
            last_update: c.last_update,
            actual_temp: c.actual_temp,
            dual_sensor_enabled: c.dual_sensor_enabled,
            preferred_sensor: c.preferred_sensor,
          }));
          mapped.sort((a, b) => (orderMap.get(a.controller_id) ?? 0) - (orderMap.get(b.controller_id) ?? 0));
          setAvailableControllers(mapped);
        }
      }
    } catch (error) {
      console.error('Error loading available controllers:', error);
    }
  }, []);

  const loadHeaderPills = useCallback(async () => {
    try {
      const { data: selected } = await supabase.from('selected_rapt_pills').select('pill_id').eq('is_visible', true);
      if (selected && selected.length > 0) {
        const pillIds = selected.map(s => s.pill_id);
        const { data: pills } = await supabase.from('rapt_pills')
          .select('pill_id, color, name, battery_level, last_update').in('pill_id', pillIds);
        if (pills) setHeaderPillsData(pills);
      }
    } catch (error) {
      console.error('Error loading header pills:', error);
    }
  }, []);

  const loadDeviceCounts = useCallback(async () => {
    try {
      const { count: pillsCount } = await supabase.from('selected_rapt_pills').select('*', { count: 'exact', head: true }).eq('is_visible', true);
      const { count: controllersCount } = await supabase.from('selected_rapt_temp_controllers').select('*', { count: 'exact', head: true }).eq('is_visible', true);
      setVisiblePillsCount(pillsCount ?? 0);
      setVisibleControllersCount(controllersCount ?? 0);
    } catch (error) {
      console.error('Error loading device counts:', error);
    }
  }, []);

  const loadBrewCounts = useCallback(async () => {
    try {
      const { count } = await supabase.from('selected_brews').select('*', { count: 'exact', head: true }).eq('is_visible', true);
      setVisibleBrewsCount(count ?? 0);
    } catch (error) {
      console.error('Error loading brew counts:', error);
    }
  }, []);

  // ─── Auth ───

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { navigate("/login"); return; }
      setUser(session.user);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) { navigate("/login"); return; }
      setUser(session.user);
      setLoading(false);
    });
    return () => subscription.unsubscribe();
  }, [navigate]);

  // ─── Initial data load + realtime ───

  useEffect(() => {
    if (!user) return;
    loadSettings();
    loadApiSettings();
    loadAvailableControllers();
    loadHeaderPills();
    loadDeviceCounts();
    loadBrewCounts();

    const channel = supabase
      .channel('sync-settings-changes')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sync_settings' }, (payload) => {
        const newData = payload.new as Tables<'sync_settings'>;
        if (newData) {
          setLastQuickSync(newData.last_rapt_quick_sync_at);
          setLastFullSync(newData.last_full_sync_at);
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rapt_temp_controllers' }, (payload) => {
        const newData = payload.new as Tables<'rapt_temp_controllers'>;
        if (newData && newData.controller_id) {
          setAvailableControllers(prev => prev.map(c => 
            c.id === newData.controller_id ? {
              ...c,
              name: newData.name ?? c.name,
              current_temp: newData.current_temp ?? c.current_temp,
              pill_temp: newData.pill_temp ?? c.pill_temp,
              target_temp: newData.target_temp ?? c.target_temp,
              profile_target_temp: newData.profile_target_temp ?? c.profile_target_temp,
              cooling_enabled: newData.cooling_enabled ?? c.cooling_enabled,
              heating_enabled: newData.heating_enabled ?? c.heating_enabled,
              cooling_hysteresis: newData.cooling_hysteresis ?? c.cooling_hysteresis,
              linked_pill_id: newData.linked_pill_id ?? c.linked_pill_id,
              is_glycol_cooler: newData.is_glycol_cooler ?? c.is_glycol_cooler,
              last_update: newData.last_update ?? c.last_update,
            } : c
          ));
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, loadSettings, loadApiSettings, loadAvailableControllers, loadHeaderPills, loadDeviceCounts, loadBrewCounts]);

  // ─── Handlers ───

  const updateSyncSetting = useCallback(async (field: string, value: string | number | boolean) => {
    if (!settingsId) return;
    try {
      const { error } = await supabase.from('sync_settings').update({ [field]: value } as never).eq('id', settingsId);
      if (error) throw error;
      toast({ title: "Inställningar sparade" });
    } catch {
      toast({ title: "Fel", description: "Kunde inte spara inställningar", variant: "destructive" });
    }
  }, [settingsId, toast]);

  const handleQuickSyncIntervalChange = useCallback(async (value: string) => {
    setQuickSyncInterval(value);
    // Write to rapt_sync_interval which drives the cron trigger
    await updateSyncSetting('rapt_sync_interval', parseInt(value));
  }, [updateSyncSetting]);

  const handleFullSyncIntervalChange = useCallback(async (value: string) => {
    setFullSyncInterval(value);
    await updateSyncSetting('full_sync_interval', parseInt(value));
  }, [updateSyncSetting]);

  const handleAutoSettingChange = useCallback(async (field: string, value: boolean) => {
    switch (field) {
      case 'auto_hide_completed': setAutoHideCompleted(value); break;
      case 'auto_hide_conditioning': setAutoHideConditioning(value); break;
      case 'auto_hide_archived': setAutoHideArchived(value); break;
      case 'auto_activate_fermenting': setAutoActivateFermenting(value); break;
    }
    await updateSyncSetting(field, value);
  }, [updateSyncSetting]);

  const handleSplashDelayChange = useCallback(async (value: string) => {
    setSplashDelayMs(value);
    await updateSyncSetting('splash_delay_ms', parseInt(value));
  }, [updateSyncSetting]);

  const handlePillStaleThresholdChange = useCallback(async (value: string) => {
    setPillStaleThresholdMin(value);
    await updateSyncSetting('pill_stale_threshold_min', parseInt(value));
  }, [updateSyncSetting]);

  const handleProbeStaleThresholdChange = useCallback(async (value: string) => {
    setProbeStaleThresholdMin(value);
    await updateSyncSetting('probe_stale_threshold_min', parseInt(value));
  }, [updateSyncSetting]);

  const handleQuickSync = useCallback(async () => {
    setQuickSyncing(true);
    try {
      const { error } = await supabase.functions.invoke('sync-rapt-data-quick', { body: {} });
      if (error) throw error;
      toast({ title: "Synkronisering klar", description: "Snabb-synk har genomförts (RAPT + custom)" });
      await loadSettings();
    } catch {
      toast({ title: "Fel", description: "Kunde inte genomföra synkronisering", variant: "destructive" });
    } finally {
      setQuickSyncing(false);
    }
  }, [toast, loadSettings]);

  const handleFullSync = useCallback(async () => {
    setSyncing(true);
    const steps = [
      { id: 'ai-audit', label: 'AI-konsultation', completed: false, inProgress: false },
    ];
    setSyncSteps(steps);
    try {
      setSyncSteps(prev => prev.map(s => s.id === 'ai-audit' ? { ...s, inProgress: true } : s));
      const { error } = await supabase.functions.invoke('ai-consultation', { body: {} });
      if (error) throw error;
      setSyncSteps(prev => prev.map(s => s.id === 'ai-audit' ? { ...s, completed: true, inProgress: false } : s));
      toast({ title: "AI-konsultation klar", description: "AI-optimering har genomförts" });
      await loadSettings();
    } catch {
      toast({ title: "Fel", description: "Kunde inte genomföra AI-konsultation", variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  }, [toast, loadSettings]);

  const handleLogout = useCallback(async () => {
    try {
      await supabase.auth.signOut();
      navigate("/login");
    } catch {
      toast({ title: "Fel", description: "Kunde inte logga ut", variant: "destructive" });
    }
  }, [navigate, toast]);

  const handleForceTvRefresh = useCallback(async () => {
    await supabase.from('sync_settings').update({ force_tv_refresh_at: new Date().toISOString() }).not('id', 'is', null);
    toast({ title: "TV-uppdatering skickad", description: "Alla TV-enheter laddas om inom kort." });
  }, [toast]);

  return {
    // Auth
    user, loading,
    // Sync — unified 2-tier
    quickSyncInterval, fullSyncInterval, splashDelayMs,
    pillStaleThresholdMin, probeStaleThresholdMin,
    lastFullSync, lastQuickSync,
    syncing, quickSyncing,
    syncSteps,
    apiSettings,
    settingsId,
    autoHideCompleted, autoHideConditioning, autoHideArchived, autoActivateFermenting,
    coolerControllerId, followedControllerIds,
    // Controllers & devices
    availableControllers, headerControllers, headerPillsData,
    visiblePillsCount, visibleControllersCount, visibleBrewsCount,
    externalLoginDialogOpen, setExternalLoginDialogOpen,
    // Handlers
    handleQuickSyncIntervalChange, handleFullSyncIntervalChange,
    handleAutoSettingChange, handleSplashDelayChange,
    handlePillStaleThresholdChange, handleProbeStaleThresholdChange,
    handleQuickSync, handleFullSync,
    handleLogout, handleForceTvRefresh,
  };
}
