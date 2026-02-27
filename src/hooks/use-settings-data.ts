import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { TempController } from "@/types/brew";
import { User } from "@supabase/supabase-js";

interface AvailableController {
  id: string;
  controller_id: string;
  name: string;
  current_temp: number | null;
  pill_temp: number | null;
  target_temp: number | null;
  cooling_enabled: boolean | null;
  heating_enabled: boolean | null;
  cooling_hysteresis: number | null;
  linked_pill_id: string | null;
  is_glycol_cooler: boolean;
}

interface ApiSettings {
  brewfather: { userId: string; apiKey: string; configured: boolean };
  rapt: { username: string; apiSecret: string; configured: boolean };
}

interface LastAdjustment {
  created_at: string;
  old_target_temp: number;
  new_target_temp: number;
  reason: string;
  followed_controller_name: string | null;
  followed_current_temp: number | null;
  followed_target_temp: number | null;
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

  // Sync settings
  const [syncInterval, setSyncInterval] = useState<string>("60");
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [autoHideCompleted, setAutoHideCompleted] = useState(true);
  const [autoHideConditioning, setAutoHideConditioning] = useState(true);
  const [autoHideArchived, setAutoHideArchived] = useState(true);
  const [autoActivateFermenting, setAutoActivateFermenting] = useState(true);
  const [fullSyncInterval, setFullSyncInterval] = useState<string>("86400");
  const [raptSyncInterval, setRaptSyncInterval] = useState<string>("900");
  const [raptFullSyncInterval, setRaptFullSyncInterval] = useState<string>("86400");
  const [splashDelayMs, setSplashDelayMs] = useState<string>("1000");
  const [lastFullSync, setLastFullSync] = useState<string | null>(null);
  const [lastBrewfatherQuickSync, setLastBrewfatherQuickSync] = useState<string | null>(null);
  const [lastRaptSync, setLastRaptSync] = useState<string | null>(null);
  const [lastRaptQuickSync, setLastRaptQuickSync] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [quickSyncing, setQuickSyncing] = useState(false);
  const [raptSyncing, setRaptSyncing] = useState(false);
  const [raptQuickSyncing, setRaptQuickSyncing] = useState(false);
  const [syncSteps, setSyncSteps] = useState<SyncStep[]>([]);
  const [raptSyncSteps, setRaptSyncSteps] = useState<SyncStep[]>([]);
  const [apiSettings, setApiSettings] = useState<ApiSettings | null>(null);

  // Auto-cooling settings
  const [autoCoolingEnabled, setAutoCoolingEnabled] = useState(false);
  const [autoCoolingInterval, setAutoCoolingInterval] = useState<string>("60");
  const [tempReduction, setTempReduction] = useState<string>("2");
  const [maxDiffFromLowest, setMaxDiffFromLowest] = useState<string>("10");
  const [autoCoolingSettingsId, setAutoCoolingSettingsId] = useState<string | null>(null);
  const [coolerControllerId, setCoolerControllerId] = useState<string>("");
  const [followedControllerIds, setFollowedControllerIds] = useState<string[]>([]);
  const [deltaAlertThreshold, setDeltaAlertThreshold] = useState<string>("2");
  const [pillCompEnabled, setPillCompEnabled] = useState(true);
  const [pillCompMaxCompensation, setPillCompMaxCompensation] = useState<string>("5.0");
  const [stallDetectionEnabled, setStallDetectionEnabled] = useState(false);
  const [stallBoostDegrees, setStallBoostDegrees] = useState<string>("1.0");
  const [overshootPreventionEnabled, setOvershootPreventionEnabled] = useState(true);
  const [aiAuditEnabled, setAiAuditEnabled] = useState(true);
  const [lastAutoCoolingCheck, setLastAutoCoolingCheck] = useState<string | null>(null);
  const [lastAdjustment, setLastAdjustment] = useState<LastAdjustment | null>(null);

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
      last_update: null,
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
        setSyncInterval(data.sync_interval.toString());
        setAutoHideCompleted(data.auto_hide_completed ?? true);
        setAutoHideConditioning(data.auto_hide_conditioning ?? true);
        setAutoHideArchived((data as any).auto_hide_archived ?? true);
        setAutoActivateFermenting(data.auto_activate_fermenting ?? true);
        setFullSyncInterval(data.full_sync_interval?.toString() ?? "86400");
        setLastRaptSync(data.last_rapt_sync_at);
        setLastRaptQuickSync(data.last_rapt_quick_sync_at);
        setRaptSyncInterval(data.rapt_sync_interval?.toString() ?? "900");
        setRaptFullSyncInterval((data as any).rapt_full_sync_interval?.toString() ?? "86400");
        setSplashDelayMs((data as any).splash_delay_ms?.toString() ?? "1000");
        setLastFullSync(data.last_full_sync_at);
        setLastBrewfatherQuickSync(data.last_sync_time);
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

  const loadAutoCoolingSettings = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('auto_cooling_settings').select('*').limit(1).maybeSingle();
      if (error) throw error;
      if (data) {
        setAutoCoolingSettingsId(data.id);
        setAutoCoolingEnabled(data.enabled);
        setAutoCoolingInterval(data.check_interval_minutes.toString());
        setTempReduction(data.temp_reduction_degrees.toString());
        setMaxDiffFromLowest(data.max_diff_from_lowest.toString());
        setLastAutoCoolingCheck(data.last_check_at);
        setStallDetectionEnabled((data as any).auto_boost_enabled ?? false);
        setStallBoostDegrees(((data as any).auto_boost_degrees ?? 1.0).toString());
        setPillCompEnabled((data as any).pill_compensation_enabled ?? false);
        setPillCompMaxCompensation(((data as any).pill_compensation_max_compensation ?? 5.0).toString());
        setDeltaAlertThreshold(((data as any).delta_alert_threshold ?? 2.0).toString());
        setOvershootPreventionEnabled((data as any).overshoot_prevention_enabled ?? true);
        setAiAuditEnabled((data as any).ai_audit_enabled ?? true);
      }
      const { data: adjData } = await supabase.from('auto_cooling_adjustments')
        .select('created_at, old_target_temp, new_target_temp, reason, followed_controller_name, followed_current_temp, followed_target_temp')
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      setLastAdjustment(adjData);
    } catch (error) {
      console.error('Error loading auto cooling settings:', error);
    }
  }, []);

  const loadAvailableControllers = useCallback(async () => {
    try {
      const { data: selected } = await supabase.from('selected_rapt_temp_controllers').select('controller_id').eq('is_visible', true);
      if (selected && selected.length > 0) {
        const controllerIds = selected.map(s => s.controller_id);
        const { data: controllers } = await supabase.from('rapt_temp_controllers')
          .select('controller_id, name, current_temp, pill_temp, target_temp, cooling_enabled, heating_enabled, cooling_hysteresis, linked_pill_id, is_glycol_cooler')
          .in('controller_id', controllerIds);
        if (controllers) {
          setAvailableControllers(controllers.map(c => ({
            id: c.controller_id, controller_id: c.controller_id, name: c.name,
            current_temp: c.current_temp, pill_temp: c.pill_temp, target_temp: c.target_temp,
            cooling_enabled: c.cooling_enabled, heating_enabled: c.heating_enabled,
            cooling_hysteresis: c.cooling_hysteresis, linked_pill_id: c.linked_pill_id,
            is_glycol_cooler: (c as any).is_glycol_cooler ?? false
          })));
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
    loadAutoCoolingSettings();
    loadAvailableControllers();
    loadHeaderPills();
    loadDeviceCounts();
    loadBrewCounts();

    const channel = supabase
      .channel('sync-settings-changes')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sync_settings' }, (payload) => {
        const newData = payload.new as any;
        if (newData) {
          setLastRaptSync(newData.last_rapt_sync_at);
          setLastRaptQuickSync(newData.last_rapt_quick_sync_at);
          setLastFullSync(newData.last_full_sync_at);
          setLastBrewfatherQuickSync(newData.last_sync_time);
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'auto_cooling_adjustments' }, () => {
        setLastAutoCoolingCheck(new Date().toISOString());
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'auto_cooling_settings' }, (payload) => {
        const newData = payload.new as any;
        if (newData) {
          if (newData.last_check_at !== undefined) setLastAutoCoolingCheck(newData.last_check_at);
          if (newData.enabled !== undefined) setAutoCoolingEnabled(newData.enabled);
          if (newData.check_interval_minutes !== undefined) setAutoCoolingInterval(newData.check_interval_minutes.toString());
          if (newData.temp_reduction_degrees !== undefined) setTempReduction(newData.temp_reduction_degrees.toString());
          if (newData.max_diff_from_lowest !== undefined) setMaxDiffFromLowest(newData.max_diff_from_lowest.toString());
          if (newData.cooler_controller_id !== undefined) setCoolerControllerId(newData.cooler_controller_id || "");
          if (newData.auto_boost_enabled !== undefined) setStallDetectionEnabled(newData.auto_boost_enabled);
          if (newData.auto_boost_degrees !== undefined) setStallBoostDegrees(newData.auto_boost_degrees.toString());
          if (newData.pill_compensation_enabled !== undefined) setPillCompEnabled(newData.pill_compensation_enabled);
          if (newData.delta_alert_threshold !== undefined) setDeltaAlertThreshold(newData.delta_alert_threshold.toString());
          if (newData.overshoot_prevention_enabled !== undefined) setOvershootPreventionEnabled(newData.overshoot_prevention_enabled);
          if (newData.ai_audit_enabled !== undefined) setAiAuditEnabled(newData.ai_audit_enabled);
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rapt_temp_controllers' }, (payload) => {
        const newData = payload.new as any;
        if (newData && newData.controller_id) {
          setAvailableControllers(prev => prev.map(c => 
            c.id === newData.controller_id ? {
              ...c,
              name: newData.name ?? c.name,
              current_temp: newData.current_temp ?? c.current_temp,
              pill_temp: newData.pill_temp ?? c.pill_temp,
              target_temp: newData.target_temp ?? c.target_temp,
              cooling_enabled: newData.cooling_enabled ?? c.cooling_enabled,
              heating_enabled: newData.heating_enabled ?? c.heating_enabled,
              cooling_hysteresis: newData.cooling_hysteresis ?? c.cooling_hysteresis,
              linked_pill_id: newData.linked_pill_id ?? c.linked_pill_id,
              is_glycol_cooler: newData.is_glycol_cooler ?? c.is_glycol_cooler,
            } : c
          ));
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, loadSettings, loadApiSettings, loadAutoCoolingSettings, loadAvailableControllers, loadHeaderPills, loadDeviceCounts, loadBrewCounts]);

  // ─── Handlers ───

  const updateSyncSetting = useCallback(async (field: string, value: any) => {
    if (!settingsId) return;
    try {
      const { error } = await supabase.from('sync_settings').update({ [field]: value }).eq('id', settingsId);
      if (error) throw error;
      toast({ title: "Inställningar sparade" });
    } catch {
      toast({ title: "Fel", description: "Kunde inte spara inställningar", variant: "destructive" });
    }
  }, [settingsId, toast]);

  const updateAutoCoolingSetting = useCallback(async (field: string, value: any) => {
    if (!autoCoolingSettingsId) return;
    try {
      const { error } = await supabase.from('auto_cooling_settings').update({ [field]: value } as any).eq('id', autoCoolingSettingsId);
      if (error) throw error;
      toast({ title: "Inställningar sparade" });
    } catch {
      toast({ title: "Fel", description: "Kunde inte spara inställningar", variant: "destructive" });
    }
  }, [autoCoolingSettingsId, toast]);

  const handleSyncIntervalChange = useCallback(async (value: string) => {
    setSyncInterval(value);
    await updateSyncSetting('sync_interval', parseInt(value));
  }, [updateSyncSetting]);

  const handleFullSyncIntervalChange = useCallback(async (value: string) => {
    setFullSyncInterval(value);
    await updateSyncSetting('full_sync_interval', parseInt(value));
  }, [updateSyncSetting]);

  const handleRaptSyncIntervalChange = useCallback(async (value: string) => {
    setRaptSyncInterval(value);
    await updateSyncSetting('rapt_sync_interval', parseInt(value));
  }, [updateSyncSetting]);

  const handleRaptFullSyncIntervalChange = useCallback(async (value: string) => {
    setRaptFullSyncInterval(value);
    await updateSyncSetting('rapt_full_sync_interval', parseInt(value));
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

  const handleQuickSync = useCallback(async () => {
    setQuickSyncing(true);
    try {
      const { error } = await supabase.functions.invoke('sync-brew-data', { body: {} });
      if (error) throw error;
      toast({ title: "Synkronisering klar", description: "Snabb synkronisering har genomförts" });
    } catch {
      toast({ title: "Fel", description: "Kunde inte genomföra synkronisering", variant: "destructive" });
    } finally {
      setQuickSyncing(false);
    }
  }, [toast]);

  const handleFullSync = useCallback(async () => {
    setSyncing(true);
    const steps = [
      { id: 'brewfather-data', label: 'Brewfather data', completed: false, inProgress: false },
      { id: 'rapt-data', label: 'RAPT data', completed: false, inProgress: false },
    ];
    setSyncSteps(steps);
    try {
      const syncPromise = supabase.functions.invoke('full-sync-brew-data', { body: {} });
      setSyncSteps(prev => prev.map(s => s.id === 'brewfather-data' ? { ...s, inProgress: true } : s));
      await new Promise(resolve => setTimeout(resolve, 2000));
      setSyncSteps(prev => prev.map(s => s.id === 'brewfather-data' ? { ...s, completed: true, inProgress: false } : s));
      setSyncSteps(prev => prev.map(s => s.id === 'rapt-data' ? { ...s, inProgress: true } : s));
      const { error } = await syncPromise;
      if (error) throw error;
      setSyncSteps(prev => prev.map(s => s.id === 'rapt-data' ? { ...s, completed: true, inProgress: false } : s));
      toast({ title: "Synkronisering klar", description: "Full synkronisering har genomförts" });
      await loadSettings();
    } catch {
      toast({ title: "Fel", description: "Kunde inte genomföra synkronisering", variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  }, [toast, loadSettings]);

  const handleRaptQuickSync = useCallback(async () => {
    setRaptQuickSyncing(true);
    try {
      const { error } = await supabase.functions.invoke('sync-rapt-data-quick', { body: {} });
      if (error) throw error;
      toast({ title: "Snabb RAPT synkning klar", description: "Data för valda enheter har uppdaterats" });
      await loadSettings();
    } catch {
      toast({ title: "Fel", description: "Kunde inte synkronisera RAPT data", variant: "destructive" });
    } finally {
      setRaptQuickSyncing(false);
    }
  }, [toast, loadSettings]);

  const handleRaptFullSync = useCallback(async () => {
    setRaptSyncing(true);
    const steps = [
      { id: 'rapt-auth', label: 'RAPT autentisering', completed: false, inProgress: false },
      { id: 'rapt-pills', label: 'RAPT pills', completed: false, inProgress: false },
      { id: 'rapt-controllers', label: 'RAPT temperaturkontroller', completed: false, inProgress: false },
    ];
    setRaptSyncSteps(steps);
    try {
      const syncPromise = supabase.functions.invoke('sync-rapt-data', { body: {} });
      setRaptSyncSteps(prev => prev.map(s => s.id === 'rapt-auth' ? { ...s, inProgress: true } : s));
      await new Promise(resolve => setTimeout(resolve, 1000));
      setRaptSyncSteps(prev => prev.map(s => s.id === 'rapt-auth' ? { ...s, completed: true, inProgress: false } : s));
      setRaptSyncSteps(prev => prev.map(s => s.id === 'rapt-pills' ? { ...s, inProgress: true } : s));
      await new Promise(resolve => setTimeout(resolve, 3000));
      setRaptSyncSteps(prev => prev.map(s => s.id === 'rapt-pills' ? { ...s, completed: true, inProgress: false } : s));
      setRaptSyncSteps(prev => prev.map(s => s.id === 'rapt-controllers' ? { ...s, inProgress: true } : s));
      const { error } = await syncPromise;
      if (error) throw error;
      setRaptSyncSteps(prev => prev.map(s => s.id === 'rapt-controllers' ? { ...s, completed: true, inProgress: false } : s));
      toast({ title: "Full RAPT synkning klar", description: "Alla enheter har uppdaterats" });
      await loadSettings();
    } catch {
      toast({ title: "Fel", description: "Kunde inte synkronisera RAPT data", variant: "destructive" });
    } finally {
      setRaptSyncing(false);
    }
  }, [toast, loadSettings]);

  // Auto-cooling handlers
  const handleAutoCoolingEnabledChange = useCallback(async (checked: boolean) => {
    setAutoCoolingEnabled(checked);
    await updateAutoCoolingSetting('enabled', checked);
  }, [updateAutoCoolingSetting]);

  const handleAutoCoolingIntervalChange = useCallback(async (value: string) => {
    setAutoCoolingInterval(value);
    await updateAutoCoolingSetting('check_interval_minutes', parseInt(value));
  }, [updateAutoCoolingSetting]);

  const handleTempReductionChange = useCallback(async (value: string) => {
    setTempReduction(value);
    await updateAutoCoolingSetting('temp_reduction_degrees', parseFloat(value));
  }, [updateAutoCoolingSetting]);

  const handleMaxDiffChange = useCallback(async (value: string) => {
    setMaxDiffFromLowest(value);
    await updateAutoCoolingSetting('max_diff_from_lowest', parseFloat(value));
  }, [updateAutoCoolingSetting]);

  const handleDeltaAlertThresholdChange = useCallback(async (value: string) => {
    setDeltaAlertThreshold(value);
    await updateAutoCoolingSetting('delta_alert_threshold', parseFloat(value));
  }, [updateAutoCoolingSetting]);

  const handlePillCompEnabledChange = useCallback(async (checked: boolean) => {
    setPillCompEnabled(checked);
    await updateAutoCoolingSetting('pill_compensation_enabled', checked);
  }, [updateAutoCoolingSetting]);

  const handlePillCompMaxCompensationChange = useCallback(async (value: string) => {
    setPillCompMaxCompensation(value);
    await updateAutoCoolingSetting('pill_compensation_max_compensation', parseFloat(value));
  }, [updateAutoCoolingSetting]);

  const handleStallDetectionEnabledChange = useCallback(async (checked: boolean) => {
    setStallDetectionEnabled(checked);
    await updateAutoCoolingSetting('auto_boost_enabled', checked);
  }, [updateAutoCoolingSetting]);

  const handleStallBoostDegreesChange = useCallback(async (value: string) => {
    setStallBoostDegrees(value);
    await updateAutoCoolingSetting('auto_boost_degrees', parseFloat(value));
  }, [updateAutoCoolingSetting]);

  const handleOvershootPreventionChange = useCallback(async (checked: boolean) => {
    setOvershootPreventionEnabled(checked);
    await updateAutoCoolingSetting('overshoot_prevention_enabled', checked);
  }, [updateAutoCoolingSetting]);

  const handleAiAuditEnabledChange = useCallback(async (checked: boolean) => {
    setAiAuditEnabled(checked);
    await updateAutoCoolingSetting('ai_audit_enabled', checked);
  }, [updateAutoCoolingSetting]);

  const handleCoolerControllerChange = useCallback(async (value: string) => {
    setCoolerControllerId(value);
    await updateAutoCoolingSetting('cooler_controller_id', value);
  }, [updateAutoCoolingSetting]);

  const handleFollowedControllerToggle = useCallback(async (controllerId: string, checked: boolean) => {
    try {
      if (checked) {
        const { error } = await supabase.from('auto_cooling_followed_controllers').insert({ controller_id: controllerId });
        if (error) throw error;
        setFollowedControllerIds(prev => [...prev, controllerId]);
      } else {
        const { error } = await supabase.from('auto_cooling_followed_controllers').delete().eq('controller_id', controllerId);
        if (error) throw error;
        setFollowedControllerIds(prev => prev.filter(id => id !== controllerId));
      }
      toast({ title: "Inställningar sparade", description: checked ? "Controller tillagd" : "Controller borttagen" });
    } catch {
      toast({ title: "Fel", description: "Kunde inte spara inställningar", variant: "destructive" });
    }
  }, [toast]);

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
    // Sync
    syncInterval, fullSyncInterval, raptSyncInterval, raptFullSyncInterval, splashDelayMs,
    lastFullSync, lastBrewfatherQuickSync, lastRaptSync, lastRaptQuickSync,
    syncing, quickSyncing, raptSyncing, raptQuickSyncing,
    syncSteps, raptSyncSteps,
    apiSettings,
    settingsId,
    autoHideCompleted, autoHideConditioning, autoHideArchived, autoActivateFermenting,
    // Auto-cooling
    autoCoolingEnabled, autoCoolingInterval, tempReduction, maxDiffFromLowest,
    coolerControllerId, followedControllerIds, deltaAlertThreshold,
    pillCompEnabled, pillCompMaxCompensation,
    stallDetectionEnabled, stallBoostDegrees, overshootPreventionEnabled, aiAuditEnabled,
    lastAutoCoolingCheck, lastAdjustment,
    // Controllers & devices
    availableControllers, headerControllers, headerPillsData,
    visiblePillsCount, visibleControllersCount, visibleBrewsCount,
    externalLoginDialogOpen, setExternalLoginDialogOpen,
    // Handlers
    handleSyncIntervalChange, handleFullSyncIntervalChange,
    handleRaptSyncIntervalChange, handleRaptFullSyncIntervalChange,
    handleAutoSettingChange, handleSplashDelayChange,
    handleQuickSync, handleFullSync, handleRaptQuickSync, handleRaptFullSync,
    handleAutoCoolingEnabledChange, handleAutoCoolingIntervalChange,
    handleTempReductionChange, handleMaxDiffChange, handleDeltaAlertThresholdChange,
    handlePillCompEnabledChange, handlePillCompMaxCompensationChange,
    handleStallDetectionEnabledChange, handleStallBoostDegreesChange,
    handleOvershootPreventionChange, handleAiAuditEnabledChange, handleCoolerControllerChange,
    handleFollowedControllerToggle,
    handleLogout, handleForceTvRefresh,
  };
}
