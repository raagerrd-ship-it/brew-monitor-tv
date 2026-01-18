import { BrewManagement } from "@/components/BrewManagement";
import { RaptPillsManagement } from "@/components/RaptPillsManagement";
import { RaptControllersManagement } from "@/components/RaptControllersManagement";
import { SyncChecklist } from "@/components/SyncChecklist";
import { AutoCoolingCountdown } from "@/components/AutoCoolingCountdown";
import { AutoCoolingDecisionLogs } from "@/components/AutoCoolingDecisionLogs";
import { FermentationProfilesManagement } from "@/components/fermentation";
import { ExternalLoginDialog } from "@/components/ExternalLoginDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, RefreshCw, LogOut, ChevronDown, Thermometer, Cpu, Beer, AlertCircle, Timer, Check, Tv } from "lucide-react";
import { useEffect, useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { User } from "@supabase/supabase-js";
import { useExternalAuth } from "@/contexts/ExternalAuthContext";
import { useExternalUserSettings } from "@/hooks/use-external-user-settings";

export default function Settings() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Get initial tab from URL or default to "sync"
  const validTabs = ["sync", "automation", "devices", "brews"];
  const tabFromUrl = searchParams.get("tab");
  const initialTab = tabFromUrl && validTabs.includes(tabFromUrl) ? tabFromUrl : "sync";

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value });
  };
  const [syncInterval, setSyncInterval] = useState<string>("60");
  const [syncing, setSyncing] = useState(false);
  const [quickSyncing, setQuickSyncing] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [autoHideCompleted, setAutoHideCompleted] = useState(true);
  const [autoHideConditioning, setAutoHideConditioning] = useState(true);
  const [autoHideArchived, setAutoHideArchived] = useState(true);
  const [autoActivateFermenting, setAutoActivateFermenting] = useState(true);
  const [fullSyncInterval, setFullSyncInterval] = useState<string>("86400");
  const [raptSyncing, setRaptSyncing] = useState(false);
  const [raptQuickSyncing, setRaptQuickSyncing] = useState(false);
  const [lastRaptSync, setLastRaptSync] = useState<string | null>(null);
  const [lastRaptQuickSync, setLastRaptQuickSync] = useState<string | null>(null);
  const [raptSyncInterval, setRaptSyncInterval] = useState<string>("900");
  const [lastFullSync, setLastFullSync] = useState<string | null>(null);
  const [lastBrewfatherQuickSync, setLastBrewfatherQuickSync] = useState<string | null>(null);
  const [apiSettings, setApiSettings] = useState<{
    brewfather: { userId: string; apiKey: string; configured: boolean };
    rapt: { username: string; apiSecret: string; configured: boolean };
  } | null>(null);
  const [autoCoolingEnabled, setAutoCoolingEnabled] = useState(false);
  const [autoCoolingInterval, setAutoCoolingInterval] = useState<string>("60");
  const [tempReduction, setTempReduction] = useState<string>("2");
  const [maxDiffFromLowest, setMaxDiffFromLowest] = useState<string>("10");
  const [autoCoolingSettingsId, setAutoCoolingSettingsId] = useState<string | null>(null);
  const [coolerControllerId, setCoolerControllerId] = useState<string>("");
  const [followedControllerIds, setFollowedControllerIds] = useState<string[]>([]);
  const [availableControllers, setAvailableControllers] = useState<Array<{
    id: string, 
    controller_id: string,
    name: string, 
    current_temp: number | null,
    pill_temp: number | null,
    target_temp: number | null,
    cooling_enabled: boolean | null,
    cooling_hysteresis: number | null
  }>>([]);
  const [adjustmentLogs, setAdjustmentLogs] = useState<Array<{
    id: string;
    created_at: string;
    cooler_controller_name: string;
    old_target_temp: number;
    new_target_temp: number;
    lowest_followed_temp: number;
    followed_controller_id: string | null;
    followed_controller_name: string | null;
    followed_current_temp: number | null;
    followed_target_temp: number | null;
    followed_hysteresis: number | null;
    reason: string;
  }>>([]);
  const [lastAutoCoolingCheck, setLastAutoCoolingCheck] = useState<string | null>(null);
  const [syncSteps, setSyncSteps] = useState<Array<{
    id: string;
    label: string;
    completed: boolean;
    inProgress: boolean;
  }>>([]);
  const [raptSyncSteps, setRaptSyncSteps] = useState<Array<{
    id: string;
    label: string;
    completed: boolean;
    inProgress: boolean;
  }>>([]);
  const [visiblePillsCount, setVisiblePillsCount] = useState(0);
  const [visibleControllersCount, setVisibleControllersCount] = useState(0);
  const [visibleBrewsCount, setVisibleBrewsCount] = useState(0);
  const [externalLoginDialogOpen, setExternalLoginDialogOpen] = useState(false);
  
  // External auth for brew timer
  const { isAuthenticated: isExternalAuthenticated, user: externalUser, signOut: externalSignOut, isLoading: externalLoading } = useExternalAuth();
  
  // External user settings (stored in database per user)
  const { timerTvModeOnly, setTimerTvModeOnly, isLoading: settingsLoading } = useExternalUserSettings();

  // Tab status indicators
  const syncTabStatus = useMemo(() => {
    if (!apiSettings) return null;
    const brewfatherMissing = !apiSettings.brewfather.configured;
    const raptMissing = !apiSettings.rapt.configured;
    if (brewfatherMissing || raptMissing) {
      return { type: 'warning' as const, count: (brewfatherMissing ? 1 : 0) + (raptMissing ? 1 : 0) };
    }
    return null;
  }, [apiSettings]);

  const automationTabStatus = useMemo(() => {
    if (!autoCoolingEnabled) return null;
    const issues: string[] = [];
    if (!coolerControllerId) issues.push('no-cooler');
    if (followedControllerIds.length === 0) issues.push('no-followed');
    if (issues.length > 0) {
      return { type: 'warning' as const, count: issues.length };
    }
    return null;
  }, [autoCoolingEnabled, coolerControllerId, followedControllerIds]);

  const devicesTabStatus = useMemo(() => {
    const total = visiblePillsCount + visibleControllersCount;
    if (total === 0) return null;
    return { type: 'info' as const, count: total };
  }, [visiblePillsCount, visibleControllersCount]);

  const brewsTabStatus = useMemo(() => {
    if (visibleBrewsCount === 0) return null;
    return { type: 'info' as const, count: visibleBrewsCount };
  }, [visibleBrewsCount]);

  // Check authentication
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        navigate("/login");
        return;
      }
      setUser(session.user);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) {
        navigate("/login");
        return;
      }
      setUser(session.user);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  useEffect(() => {
    if (!user) return;
    loadSettings();
    loadApiSettings();
    loadAutoCoolingSettings();
    loadAvailableControllers();
    loadAdjustmentLogs();
    loadDeviceCounts();
    loadBrewCounts();
    
    // Subscribe to sync_settings changes for real-time updates
    const channel = supabase
      .channel('sync-settings-changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'sync_settings'
        },
        (payload) => {
          console.log('Sync settings updated:', payload);
          const newData = payload.new as any;
          if (newData) {
            setLastRaptSync(newData.last_rapt_sync_at);
            setLastRaptQuickSync(newData.last_rapt_quick_sync_at);
            setLastFullSync(newData.last_full_sync_at);
            setLastBrewfatherQuickSync(newData.last_sync_time);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'auto_cooling_adjustments'
        },
        (payload) => {
          console.log('New adjustment log:', payload);
          loadAdjustmentLogs();
          // Update last_check_at to restart countdown immediately
          setLastAutoCoolingCheck(new Date().toISOString());
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'auto_cooling_settings'
        },
        (payload) => {
          console.log('Auto cooling settings updated:', payload);
          const newData = payload.new as any;
          if (newData) {
            if (newData.last_check_at !== undefined) {
              setLastAutoCoolingCheck(newData.last_check_at);
            }
            if (newData.enabled !== undefined) {
              setAutoCoolingEnabled(newData.enabled);
            }
            if (newData.check_interval_minutes !== undefined) {
              setAutoCoolingInterval(newData.check_interval_minutes.toString());
            }
            if (newData.temp_reduction_degrees !== undefined) {
              setTempReduction(newData.temp_reduction_degrees.toString());
            }
            if (newData.max_diff_from_lowest !== undefined) {
              setMaxDiffFromLowest(newData.max_diff_from_lowest.toString());
            }
            if (newData.cooler_controller_id !== undefined) {
              setCoolerControllerId(newData.cooler_controller_id || "");
            }
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rapt_temp_controllers'
        },
        (payload) => {
          console.log('RAPT controller updated:', payload);
          const updatedController = payload.new as any;
          if (updatedController) {
            setAvailableControllers(prev => 
              prev.map(c => 
                c.id === updatedController.controller_id 
                  ? {
                      id: updatedController.controller_id,
                      controller_id: updatedController.controller_id,
                      name: updatedController.name,
                      current_temp: updatedController.current_temp,
                      pill_temp: updatedController.pill_temp,
                      target_temp: updatedController.target_temp,
                      cooling_enabled: updatedController.cooling_enabled,
                      cooling_hysteresis: updatedController.cooling_hysteresis
                    }
                  : c
              )
            );
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rapt_temp_controllers'
        },
        (payload) => {
          console.log('Temperature controller updated:', payload);
          const newData = payload.new as any;
          if (newData && newData.controller_id) {
            setAvailableControllers(prev => {
              const index = prev.findIndex(c => c.id === newData.controller_id);
              if (index !== -1) {
                const updated = [...prev];
                updated[index] = {
                  ...updated[index],
                  name: newData.name ?? updated[index].name,
                  current_temp: newData.current_temp ?? updated[index].current_temp,
                  pill_temp: newData.pill_temp ?? updated[index].pill_temp,
                  target_temp: newData.target_temp ?? updated[index].target_temp,
                  cooling_enabled: newData.cooling_enabled ?? updated[index].cooling_enabled,
                  cooling_hysteresis: newData.cooling_hysteresis ?? updated[index].cooling_hysteresis
                };
                return updated;
              }
              return prev;
            });
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'auto_cooling_followed_controllers'
        },
        (payload) => {
          console.log('Followed controllers updated:', payload);
          loadAutoCoolingSettings();
        }
      )
      .subscribe();
    
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const loadApiSettings = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('get-api-settings');
      
      if (error) throw error;
      
      setApiSettings(data);
    } catch (error) {
      console.error('Error loading API settings:', error);
    }
  };

  const loadSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('sync_settings')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      console.log('Settings loaded:', data);

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
        setLastFullSync(data.last_full_sync_at);
        setLastBrewfatherQuickSync(data.last_sync_time);
        console.log('Last RAPT sync:', data.last_rapt_sync_at);
        console.log('Last RAPT quick sync:', data.last_rapt_quick_sync_at);
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const loadAutoCoolingSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('auto_cooling_settings')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setAutoCoolingSettingsId(data.id);
        setAutoCoolingEnabled(data.enabled);
        setAutoCoolingInterval(data.check_interval_minutes.toString());
        setTempReduction(data.temp_reduction_degrees.toString());
        setMaxDiffFromLowest(data.max_diff_from_lowest.toString());
        setCoolerControllerId(data.cooler_controller_id || "");
        setLastAutoCoolingCheck(data.last_check_at);
      }

      // Load followed controllers
      const { data: followedData, error: followedError } = await supabase
        .from('auto_cooling_followed_controllers')
        .select('controller_id');

      if (!followedError && followedData) {
        setFollowedControllerIds(followedData.map(f => f.controller_id));
      }
    } catch (error) {
      console.error('Error loading auto cooling settings:', error);
    }
  };

  const loadAvailableControllers = async () => {
    try {
      const { data: selected } = await supabase
        .from('selected_rapt_temp_controllers')
        .select('controller_id')
        .eq('is_visible', true);

      if (selected && selected.length > 0) {
        const controllerIds = selected.map(s => s.controller_id);
        const { data: controllers } = await supabase
          .from('rapt_temp_controllers')
          .select('controller_id, name, current_temp, pill_temp, target_temp, cooling_enabled, cooling_hysteresis')
          .in('controller_id', controllerIds);

        if (controllers) {
          setAvailableControllers(controllers.map(c => ({ 
            id: c.controller_id, 
            controller_id: c.controller_id,
            name: c.name,
            current_temp: c.current_temp,
            pill_temp: c.pill_temp,
            target_temp: c.target_temp,
            cooling_enabled: c.cooling_enabled,
            cooling_hysteresis: c.cooling_hysteresis
          })));
        }
      }
    } catch (error) {
      console.error('Error loading available controllers:', error);
    }
  };

  const loadAdjustmentLogs = async () => {
    try {
      const { data, error } = await supabase
        .from('auto_cooling_adjustments')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      if (data) {
        setAdjustmentLogs(data);
      }
    } catch (error) {
      console.error('Error loading adjustment logs:', error);
    }
  };

  const loadDeviceCounts = async () => {
    try {
      const { count: pillsCount } = await supabase
        .from('selected_rapt_pills')
        .select('*', { count: 'exact', head: true })
        .eq('is_visible', true);
      
      const { count: controllersCount } = await supabase
        .from('selected_rapt_temp_controllers')
        .select('*', { count: 'exact', head: true })
        .eq('is_visible', true);
      
      setVisiblePillsCount(pillsCount ?? 0);
      setVisibleControllersCount(controllersCount ?? 0);
    } catch (error) {
      console.error('Error loading device counts:', error);
    }
  };

  const loadBrewCounts = async () => {
    try {
      const { count } = await supabase
        .from('selected_brews')
        .select('*', { count: 'exact', head: true })
        .eq('is_visible', true);
      
      setVisibleBrewsCount(count ?? 0);
    } catch (error) {
      console.error('Error loading brew counts:', error);
    }
  };

  const handleSyncIntervalChange = async (value: string) => {
    setSyncInterval(value);
    
    try {
      if (settingsId) {
        const { error } = await supabase
          .from('sync_settings')
          .update({ sync_interval: parseInt(value) })
          .eq('id', settingsId);

        if (error) throw error;

        toast({
          title: "Inställningar sparade",
          description: "Synkroniseringsfrekvensen har uppdaterats",
        });
      }
    } catch (error) {
      console.error('Error updating settings:', error);
      toast({
        title: "Fel",
        description: "Kunde inte spara inställningar",
        variant: "destructive",
      });
    }
  };

  const handleFullSyncIntervalChange = async (value: string) => {
    setFullSyncInterval(value);
    
    try {
      if (settingsId) {
        const { error } = await supabase
          .from('sync_settings')
          .update({ full_sync_interval: parseInt(value) })
          .eq('id', settingsId);

        if (error) throw error;

        toast({
          title: "Inställningar sparade",
          description: "Full synkroniseringsfrekvens har uppdaterats",
        });
      }
    } catch (error) {
      console.error('Error updating full sync interval:', error);
      toast({
        title: "Fel",
        description: "Kunde inte spara inställningar",
        variant: "destructive",
      });
    }
  };

  const handleAutoSettingChange = async (field: string, value: boolean) => {
    try {
      if (settingsId) {
        const { error } = await supabase
          .from('sync_settings')
          .update({ [field]: value })
          .eq('id', settingsId);

        if (error) throw error;

        switch (field) {
          case 'auto_hide_completed':
            setAutoHideCompleted(value);
            break;
          case 'auto_hide_conditioning':
            setAutoHideConditioning(value);
            break;
          case 'auto_hide_archived':
            setAutoHideArchived(value);
            break;
          case 'auto_activate_fermenting':
            setAutoActivateFermenting(value);
            break;
        }

        toast({
          title: "Inställningar sparade",
          description: "Automatiseringsinställningarna har uppdaterats",
        });
      }
    } catch (error) {
      console.error('Error updating auto settings:', error);
      toast({
        title: "Fel",
        description: "Kunde inte spara inställningar",
        variant: "destructive",
      });
    }
  };

  const handleQuickSync = async () => {
    setQuickSyncing(true);
    try {
      const { error } = await supabase.functions.invoke('sync-brew-data', {
        body: {}
      });

      if (error) throw error;

      toast({
        title: "Synkronisering klar",
        description: "Snabb synkronisering har genomförts",
      });
    } catch (error) {
      console.error('Error during quick sync:', error);
      toast({
        title: "Fel",
        description: "Kunde inte genomföra synkronisering",
        variant: "destructive",
      });
    } finally {
      setQuickSyncing(false);
    }
  };

  const handleFullSync = async () => {
    setSyncing(true);
    
    const steps = [
      { id: 'brewfather-data', label: 'Brewfather data', completed: false, inProgress: false },
      { id: 'rapt-data', label: 'RAPT data', completed: false, inProgress: false },
    ];
    
    setSyncSteps(steps);
    
    try {
      // Show progress as sync runs
      const syncPromise = supabase.functions.invoke('full-sync-brew-data', { body: {} });
      
      setSyncSteps(prev => prev.map(s => s.id === 'brewfather-data' ? { ...s, inProgress: true } : s));
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      setSyncSteps(prev => prev.map(s => s.id === 'brewfather-data' ? { ...s, completed: true, inProgress: false } : s));
      setSyncSteps(prev => prev.map(s => s.id === 'rapt-data' ? { ...s, inProgress: true } : s));
      
      const { error } = await syncPromise;
      
      if (error) throw error;
      
      setSyncSteps(prev => prev.map(s => s.id === 'rapt-data' ? { ...s, completed: true, inProgress: false } : s));

      toast({
        title: "Synkronisering klar",
        description: "Full synkronisering har genomförts",
      });
      
      await loadSettings();
    } catch (error) {
      console.error('Error during full sync:', error);
      toast({
        title: "Fel",
        description: "Kunde inte genomföra synkronisering",
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleRaptSyncIntervalChange = async (value: string) => {
    setRaptSyncInterval(value);
    
    try {
      if (settingsId) {
        const { error } = await supabase
          .from('sync_settings')
          .update({ rapt_sync_interval: parseInt(value) })
          .eq('id', settingsId);

        if (error) throw error;

        toast({
          title: "Inställningar sparade",
          description: "RAPT synkroniseringsfrekvens har uppdaterats",
        });
      }
    } catch (error) {
      console.error('Error updating RAPT sync interval:', error);
      toast({
        title: "Fel",
        description: "Kunde inte spara inställningar",
        variant: "destructive",
      });
    }
  };

  const handleRaptQuickSync = async () => {
    setRaptQuickSyncing(true);
    try {
      const { error } = await supabase.functions.invoke('sync-rapt-data-quick', {
        body: {}
      });

      if (error) throw error;

      toast({
        title: "Snabb RAPT synkning klar",
        description: "Data för valda enheter har uppdaterats",
      });
      
      // Reload settings to get updated timestamp
      await loadSettings();
    } catch (error) {
      console.error('Error during quick RAPT sync:', error);
      toast({
        title: "Fel",
        description: "Kunde inte synkronisera RAPT data",
        variant: "destructive",
      });
    } finally {
      setRaptQuickSyncing(false);
    }
  };

  const handleRaptFullSync = async () => {
    setRaptSyncing(true);
    
    const steps = [
      { id: 'rapt-auth', label: 'RAPT autentisering', completed: false, inProgress: false },
      { id: 'rapt-pills', label: 'RAPT pills', completed: false, inProgress: false },
      { id: 'rapt-controllers', label: 'RAPT temperaturkontroller', completed: false, inProgress: false },
    ];
    
    setRaptSyncSteps(steps);
    
    try {
      // Show progress steps as the sync runs
      const syncPromise = supabase.functions.invoke('sync-rapt-data', { body: {} });
      
      // Simulate progress (auth takes ~1s, pills ~3s, controllers ~2s based on logs)
      setRaptSyncSteps(prev => prev.map(s => s.id === 'rapt-auth' ? { ...s, inProgress: true } : s));
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      setRaptSyncSteps(prev => prev.map(s => s.id === 'rapt-auth' ? { ...s, completed: true, inProgress: false } : s));
      setRaptSyncSteps(prev => prev.map(s => s.id === 'rapt-pills' ? { ...s, inProgress: true } : s));
      
      await new Promise(resolve => setTimeout(resolve, 3000));
      setRaptSyncSteps(prev => prev.map(s => s.id === 'rapt-pills' ? { ...s, completed: true, inProgress: false } : s));
      setRaptSyncSteps(prev => prev.map(s => s.id === 'rapt-controllers' ? { ...s, inProgress: true } : s));
      
      // Wait for actual sync to complete
      const { error } = await syncPromise;
      
      if (error) throw error;
      
      setRaptSyncSteps(prev => prev.map(s => s.id === 'rapt-controllers' ? { ...s, completed: true, inProgress: false } : s));

      toast({
        title: "Full RAPT synkning klar",
        description: "Alla enheter har uppdaterats",
      });
      
      await loadSettings();
    } catch (error) {
      console.error('Error during full RAPT sync:', error);
      toast({
        title: "Fel",
        description: "Kunde inte synkronisera RAPT data",
        variant: "destructive",
      });
    } finally {
      setRaptSyncing(false);
    }
  };

  const handleAutoCoolingEnabledChange = async (checked: boolean) => {
    setAutoCoolingEnabled(checked);
    try {
      if (!autoCoolingSettingsId) return;
      
      const { error } = await supabase
        .from('auto_cooling_settings')
        .update({ enabled: checked })
        .eq('id', autoCoolingSettingsId);

      if (error) throw error;

      toast({
        title: "Inställningar sparade",
        description: checked ? "Automatisk kylreglering aktiverad" : "Automatisk kylreglering inaktiverad",
      });
    } catch (error) {
      console.error('Error updating auto cooling enabled:', error);
      toast({
        title: "Fel",
        description: "Kunde inte spara inställningar",
        variant: "destructive",
      });
    }
  };

  const handleAutoCoolingIntervalChange = async (value: string) => {
    setAutoCoolingInterval(value);
    try {
      if (!autoCoolingSettingsId) return;
      
      const { error } = await supabase
        .from('auto_cooling_settings')
        .update({ check_interval_minutes: parseInt(value) })
        .eq('id', autoCoolingSettingsId);

      if (error) throw error;

      toast({
        title: "Inställningar sparade",
        description: "Kontrollintervall har uppdaterats",
      });
    } catch (error) {
      console.error('Error updating check interval:', error);
      toast({
        title: "Fel",
        description: "Kunde inte spara inställningar",
        variant: "destructive",
      });
    }
  };

  const handleTempReductionChange = async (value: string) => {
    setTempReduction(value);
    try {
      if (!autoCoolingSettingsId) return;
      
      const { error } = await supabase
        .from('auto_cooling_settings')
        .update({ temp_reduction_degrees: parseFloat(value) })
        .eq('id', autoCoolingSettingsId);

      if (error) throw error;

      toast({
        title: "Inställningar sparade",
        description: "Temperatursänkning har uppdaterats",
      });
    } catch (error) {
      console.error('Error updating temp reduction:', error);
      toast({
        title: "Fel",
        description: "Kunde inte spara inställningar",
        variant: "destructive",
      });
    }
  };

  const handleMaxDiffChange = async (value: string) => {
    setMaxDiffFromLowest(value);
    try {
      if (!autoCoolingSettingsId) return;
      
      const { error } = await supabase
        .from('auto_cooling_settings')
        .update({ max_diff_from_lowest: parseFloat(value) })
        .eq('id', autoCoolingSettingsId);

      if (error) throw error;

      toast({
        title: "Inställningar sparade",
        description: "Max differens har uppdaterats",
      });
    } catch (error) {
      console.error('Error updating max diff:', error);
      toast({
        title: "Fel",
        description: "Kunde inte spara inställningar",
        variant: "destructive",
      });
    }
  };

  const handleCoolerControllerChange = async (value: string) => {
    setCoolerControllerId(value);
    try {
      if (!autoCoolingSettingsId) return;
      
      const { error } = await supabase
        .from('auto_cooling_settings')
        .update({ cooler_controller_id: value })
        .eq('id', autoCoolingSettingsId);

      if (error) throw error;

      toast({
        title: "Inställningar sparade",
        description: "Kylare vald",
      });
    } catch (error) {
      console.error('Error updating cooler controller:', error);
      toast({
        title: "Fel",
        description: "Kunde inte spara inställningar",
        variant: "destructive",
      });
    }
  };

  const handleFollowedControllerToggle = async (controllerId: string, checked: boolean) => {
    try {
      if (checked) {
        // Add to followed controllers
        const { error } = await supabase
          .from('auto_cooling_followed_controllers')
          .insert({ controller_id: controllerId });

        if (error) throw error;
        setFollowedControllerIds([...followedControllerIds, controllerId]);
      } else {
        // Remove from followed controllers
        const { error } = await supabase
          .from('auto_cooling_followed_controllers')
          .delete()
          .eq('controller_id', controllerId);

        if (error) throw error;
        setFollowedControllerIds(followedControllerIds.filter(id => id !== controllerId));
      }

      toast({
        title: "Inställningar sparade",
        description: checked ? "Controller tillagd" : "Controller borttagen",
      });
    } catch (error) {
      console.error('Error updating followed controllers:', error);
      toast({
        title: "Fel",
        description: "Kunde inte spara inställningar",
        variant: "destructive",
      });
    }
  };

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      navigate("/login");
    } catch (error) {
      toast({
        title: "Fel",
        description: "Kunde inte logga ut",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      <div className="container mx-auto max-w-4xl">
        <div className="py-4 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/")}
            className="mb-4"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Tillbaka till Dashboard
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="mb-4"
          >
            <LogOut className="mr-2 h-4 w-4" />
            Logga ut
          </Button>
        </div>
        
        <Tabs value={initialTab} onValueChange={handleTabChange} className="w-full">
          <TabsList className="grid w-full grid-cols-4 mb-6">
            <TabsTrigger value="sync" className="flex items-center gap-2 relative">
              <RefreshCw className="h-4 w-4" />
              <span className="hidden sm:inline">Synk</span>
              {syncTabStatus && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] text-destructive-foreground">
                  <AlertCircle className="h-3 w-3" />
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="automation" className="flex items-center gap-2 relative">
              <Thermometer className="h-4 w-4" />
              <span className="hidden sm:inline">Automatik</span>
              {automationTabStatus && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] text-destructive-foreground">
                  <AlertCircle className="h-3 w-3" />
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="devices" className="flex items-center gap-2 relative">
              <Cpu className="h-4 w-4" />
              <span className="hidden sm:inline">Enheter</span>
              {devicesTabStatus && (
                <Badge className="absolute -top-2 -right-2 h-5 min-w-5 px-1 text-[10px] flex items-center justify-center bg-green-600 text-white hover:bg-green-600">
                  {devicesTabStatus.count}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="brews" className="flex items-center gap-2 relative">
              <Beer className="h-4 w-4" />
              <span className="hidden sm:inline">Öl</span>
              {brewsTabStatus && (
                <Badge className="absolute -top-2 -right-2 h-5 min-w-5 px-1 text-[10px] flex items-center justify-center bg-green-600 text-white hover:bg-green-600">
                  {brewsTabStatus.count}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* SYNC TAB */}
          <TabsContent value="sync" className="space-y-8">
            {/* Brewfather Section */}
            <div className="space-y-6">
              <h2 className="text-xl font-bold">Brewfather</h2>
              
              <div className="space-y-4 pb-4 border-b border-border">
                <h3 className="text-base font-semibold">API-uppgifter</h3>
                <p className="text-sm text-muted-foreground">
                  Be AI-assistenten uppdatera dina Brewfather-inloggningsuppgifter i chatten
                </p>
                
                {apiSettings?.brewfather && (
                  <div className="text-sm space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">User ID:</span>
                      <span className="font-mono">{apiSettings.brewfather.userId}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">API-nyckel:</span>
                      <span className="font-mono">{apiSettings.brewfather.apiKey}</span>
                    </div>
                  </div>
                )}
                
                <div className="flex flex-col sm:flex-row gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      toast({
                        title: "Uppdatera Brewfather-uppgifter",
                        description: "Be AI-assistenten i chatten att uppdatera ditt Brewfather User ID",
                      });
                    }}
                    className="flex-1"
                  >
                    Uppdatera User ID
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      toast({
                        title: "Uppdatera Brewfather-uppgifter",
                        description: "Be AI-assistenten i chatten att uppdatera din Brewfather API-nyckel",
                      });
                    }}
                    className="flex-1"
                  >
                    Uppdatera API-nyckel
                  </Button>
                </div>
              </div>
              
              <div className="space-y-4 pb-4 border-b border-border">
                <div>
                  <h3 className="text-base font-semibold">Snabb synkronisering</h3>
                  <p className="text-sm text-muted-foreground">
                    Uppdaterar löpande data för synliga öl
                  </p>
                </div>
                
                <div>
                  <label className="text-sm font-medium mb-2 block">Synkroniseringsfrekvens</label>
                  <Select value={syncInterval} onValueChange={handleSyncIntervalChange}>
                    <SelectTrigger className="w-full bg-card">
                      <SelectValue placeholder="Välj frekvens" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border z-50">
                      <SelectItem value="0">Aldrig</SelectItem>
                      <SelectItem value="60">Varje minut</SelectItem>
                      <SelectItem value="300">Var 5:e minut</SelectItem>
                      <SelectItem value="600">Var 10:e minut</SelectItem>
                      <SelectItem value="900">Var 15:e minut</SelectItem>
                      <SelectItem value="3600">Varje timme</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {lastBrewfatherQuickSync && (
                  <p className="text-sm text-muted-foreground">
                    Senast: <span className="font-medium text-foreground">
                      {new Date(lastBrewfatherQuickSync).toLocaleString("sv-SE", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </p>
                )}

                <Button
                  onClick={handleQuickSync} 
                  disabled={quickSyncing}
                  className="w-full"
                  variant="outline"
                  size="sm"
                >
                  <RefreshCw className={`mr-2 h-4 w-4 ${quickSyncing ? 'animate-spin' : ''}`} />
                  {quickSyncing ? 'Synkroniserar...' : 'Kör snabb synkronisering'}
                </Button>
              </div>

              <div className="space-y-4">
                <div>
                  <h3 className="text-base font-semibold">Full synkronisering</h3>
                  <p className="text-sm text-muted-foreground">
                    Hämtar komplett data och hanterar automatisk synlighet
                  </p>
                </div>
                
                <div>
                  <label className="text-sm font-medium mb-2 block">Frekvens</label>
                  <Select value={fullSyncInterval} onValueChange={handleFullSyncIntervalChange}>
                    <SelectTrigger className="w-full bg-card">
                      <SelectValue placeholder="Välj frekvens" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border z-50">
                      <SelectItem value="0">Aldrig</SelectItem>
                      <SelectItem value="3600">Varje timme</SelectItem>
                      <SelectItem value="21600">Var 6:e timme</SelectItem>
                      <SelectItem value="43200">Var 12:e timme</SelectItem>
                      <SelectItem value="86400">Varje dag</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <h4 className="text-sm font-medium">Automatisk hantering</h4>
                  
                  <div className="flex items-center space-x-2">
                    <Checkbox 
                      id="auto-activate-fermenting"
                      checked={autoActivateFermenting}
                      onCheckedChange={(checked) => handleAutoSettingChange('auto_activate_fermenting', !!checked)}
                    />
                    <label htmlFor="auto-activate-fermenting" className="text-sm cursor-pointer">
                      Visa nya öl med status Jäsning
                    </label>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <Checkbox 
                      id="auto-hide-completed"
                      checked={autoHideCompleted}
                      onCheckedChange={(checked) => handleAutoSettingChange('auto_hide_completed', !!checked)}
                    />
                    <label htmlFor="auto-hide-completed" className="text-sm cursor-pointer">
                      Dölj klara öl
                    </label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox 
                      id="auto-hide-conditioning"
                      checked={autoHideConditioning}
                      onCheckedChange={(checked) => handleAutoSettingChange('auto_hide_conditioning', !!checked)}
                    />
                    <label htmlFor="auto-hide-conditioning" className="text-sm cursor-pointer">
                      Dölj konditionerade öl
                    </label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox 
                      id="auto-hide-archived"
                      checked={autoHideArchived}
                      onCheckedChange={(checked) => handleAutoSettingChange('auto_hide_archived', !!checked)}
                    />
                    <label htmlFor="auto-hide-archived" className="text-sm cursor-pointer">
                      Dölj arkiverade öl
                    </label>
                  </div>
                </div>
                
                {lastFullSync && (
                  <p className="text-sm text-muted-foreground">
                    Senast: <span className="font-medium text-foreground">
                      {new Date(lastFullSync).toLocaleString("sv-SE", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </p>
                )}

                <Button 
                  onClick={handleFullSync} 
                  disabled={syncing}
                  className="w-full"
                  size="sm"
                >
                  <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
                  {syncing ? 'Synkroniserar...' : 'Kör full synkronisering'}
                </Button>

                {syncing && syncSteps.length > 0 && (
                  <SyncChecklist steps={syncSteps} />
                )}
              </div>
            </div>

            {/* RAPT Section */}
            <div className="space-y-6 pt-4 border-t border-border">
              <h2 className="text-xl font-bold">RAPT</h2>
              
              <div className="space-y-4 pb-4 border-b border-border">
                <h3 className="text-base font-semibold">API-uppgifter</h3>
                <p className="text-sm text-muted-foreground">
                  Be AI-assistenten uppdatera dina RAPT Portal-inloggningsuppgifter i chatten
                </p>
                
                {apiSettings?.rapt && (
                  <div className="text-sm space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Användarnamn:</span>
                      <span className="font-mono">{apiSettings.rapt.username}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">API-nyckel:</span>
                      <span className="font-mono">{apiSettings.rapt.apiSecret}</span>
                    </div>
                  </div>
                )}
                
                <div className="flex flex-col sm:flex-row gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      toast({
                        title: "Uppdatera RAPT-uppgifter",
                        description: "Be AI-assistenten i chatten att uppdatera ditt RAPT-användarnamn",
                      });
                    }}
                    className="flex-1"
                  >
                    Uppdatera användarnamn
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      toast({
                        title: "Uppdatera RAPT-uppgifter",
                        description: "Be AI-assistenten i chatten att uppdatera din RAPT API-nyckel",
                      });
                    }}
                    className="flex-1"
                  >
                    Uppdatera API-nyckel
                  </Button>
                </div>
              </div>

              <div className="space-y-4 pb-4 border-b border-border">
                <div>
                  <h3 className="text-base font-semibold">Snabb datasynkning</h3>
                  <p className="text-sm text-muted-foreground">
                    Uppdaterar endast data för valda enheter
                  </p>
                </div>

                <div>
                  <label className="text-sm font-medium mb-2 block">Synkroniseringsfrekvens</label>
                  <Select value={raptSyncInterval} onValueChange={handleRaptSyncIntervalChange}>
                    <SelectTrigger className="w-full bg-card">
                      <SelectValue placeholder="Välj frekvens" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border z-50">
                      <SelectItem value="0">Aldrig</SelectItem>
                      <SelectItem value="60">Varje minut</SelectItem>
                      <SelectItem value="300">Var 5:e minut</SelectItem>
                      <SelectItem value="600">Var 10:e minut</SelectItem>
                      <SelectItem value="900">Var 15:e minut</SelectItem>
                      <SelectItem value="1800">Var 30:e minut</SelectItem>
                      <SelectItem value="3600">Varje timme</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                {lastRaptQuickSync && (
                  <p className="text-sm text-muted-foreground">
                    Senast: <span className="font-medium text-foreground">
                      {new Date(lastRaptQuickSync).toLocaleString("sv-SE", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </p>
                )}

                <Button
                  onClick={handleRaptQuickSync} 
                  disabled={raptQuickSyncing}
                  className="w-full"
                  variant="outline"
                  size="sm"
                >
                  <RefreshCw className={`mr-2 h-4 w-4 ${raptQuickSyncing ? 'animate-spin' : ''}`} />
                  {raptQuickSyncing ? 'Synkroniserar...' : 'Kör snabbsynkning'}
                </Button>
              </div>

              <div className="space-y-4">
                <div>
                  <h3 className="text-base font-semibold">Full enhetssynkning</h3>
                  <p className="text-sm text-muted-foreground">
                    Hämtar alla enheter från RAPT
                  </p>
                </div>
                
                {lastRaptSync && (
                  <p className="text-sm text-muted-foreground">
                    Senast: <span className="font-medium text-foreground">
                      {new Date(lastRaptSync).toLocaleString("sv-SE", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </p>
                )}

                <Button
                  onClick={handleRaptFullSync} 
                  disabled={raptSyncing}
                  className="w-full"
                  size="sm"
                >
                  <RefreshCw className={`mr-2 h-4 w-4 ${raptSyncing ? 'animate-spin' : ''}`} />
                  {raptSyncing ? 'Synkroniserar...' : 'Kör fullsynkning'}
                </Button>

                {raptSyncing && raptSyncSteps.length > 0 && (
                  <SyncChecklist steps={raptSyncSteps} />
                )}
              </div>
            </div>
          </TabsContent>

          {/* AUTOMATION TAB */}
          <TabsContent value="automation" className="space-y-6">
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-bold">Automatisk Kylreglering</h2>
                <p className="text-sm text-muted-foreground">
                  Justerar automatiskt måltemperaturen om kylaren inte får ner temperaturen
                </p>
              </div>
              
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="auto-cooling-enabled"
                  checked={autoCoolingEnabled}
                  onCheckedChange={handleAutoCoolingEnabledChange}
                />
                <label
                  htmlFor="auto-cooling-enabled"
                  className="text-sm cursor-pointer leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Aktivera automatisk temperaturjustering
                </label>
              </div>

              {autoCoolingEnabled && (
                <div className="space-y-4 pl-4 border-l-2 border-primary/30">
                  <p className="text-sm font-medium text-primary">Aktuella inställningar:</p>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-muted-foreground">Kylare:</span>
                      <p className="font-medium">
                        {coolerControllerId 
                          ? availableControllers.find(c => c.id === coolerControllerId)?.name || 'Ej vald'
                          : 'Ej vald'}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Kylare temp:</span>
                      {coolerControllerId 
                        ? (() => {
                            const cooler = availableControllers.find(c => c.id === coolerControllerId);
                            const current = cooler?.current_temp !== null && cooler?.current_temp !== undefined
                              ? Number(cooler.current_temp).toFixed(1)
                              : 'N/A';
                            const target = cooler?.target_temp !== null && cooler?.target_temp !== undefined
                              ? Number(cooler.target_temp).toFixed(1)
                              : 'N/A';
                            return (
                              <div className="font-medium">
                                <div>{current}°C (aktuell)</div>
                                <div>{target}°C (mål)</div>
                              </div>
                            );
                          })()
                        : <p className="font-medium">N/A</p>}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Lägsta controller:</span>
                      <p className="font-medium">
                        {(() => {
                          const followedControllers = availableControllers.filter(c => 
                            followedControllerIds.includes(c.id) && c.cooling_enabled === true
                          );
                          if (followedControllers.length === 0) return 'N/A';
                          
                          const controllersWithTarget = followedControllers
                            .filter(c => c.target_temp !== null && c.target_temp !== undefined);
                          
                          if (controllersWithTarget.length === 0) return 'N/A';
                          
                          const lowestTargetTemp = Math.min(...controllersWithTarget.map(c => c.target_temp!));
                          const lowestController = controllersWithTarget.find(c => c.target_temp === lowestTargetTemp);
                          
                          return lowestController?.name || 'N/A';
                        })()}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Controller temp:</span>
                      {(() => {
                        const followedControllers = availableControllers.filter(c => 
                          followedControllerIds.includes(c.id) && c.cooling_enabled === true
                        );
                        if (followedControllers.length === 0) return <p className="font-medium">N/A</p>;
                        
                        const controllersWithTarget = followedControllers
                          .filter(c => c.target_temp !== null && c.target_temp !== undefined);
                        
                        if (controllersWithTarget.length === 0) return <p className="font-medium">N/A</p>;
                        
                        const lowestTargetTemp = Math.min(...controllersWithTarget.map(c => c.target_temp!));
                        const lowestController = controllersWithTarget.find(c => c.target_temp === lowestTargetTemp);
                        const currentTemp = lowestController?.current_temp ?? lowestController?.pill_temp;
                        
                        const hysteresis = lowestController?.cooling_hysteresis ?? 0.2;
                        
                        return (
                          <div className="font-medium">
                            <div>{currentTemp !== null && currentTemp !== undefined ? `${Number(currentTemp).toFixed(1)}°C` : 'N/A'} (aktuell)</div>
                            <div>{lowestTargetTemp.toFixed(1)}°C (mål)</div>
                            <div className="text-xs text-muted-foreground">{hysteresis.toFixed(1)}°C (tolerans)</div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="flex items-center justify-between py-2">
                    <p className="text-sm font-medium">Nästa temperaturkontroll:</p>
                    <AutoCoolingCountdown 
                      lastAdjustmentTime={lastAutoCoolingCheck}
                      checkIntervalMinutes={parseInt(autoCoolingInterval)}
                      enabled={autoCoolingEnabled}
                      coolingActive={(() => {
                        if (!coolerControllerId) return false;
                        const cooler = availableControllers.find(c => c.id === coolerControllerId);
                        return cooler?.cooling_enabled ?? false;
                      })()}
                      currentTemp={(() => {
                        const followedControllers = availableControllers.filter(c => 
                          followedControllerIds.includes(c.controller_id)
                        );
                        console.log('Followed controllers for countdown:', followedControllers);
                        
                        if (followedControllers.length === 0) return null;
                        
                        const controllersWithTarget = followedControllers
                          .filter(c => c.target_temp !== null && c.target_temp !== undefined && c.cooling_enabled === true);
                        
                        console.log('Controllers with target and cooling enabled:', controllersWithTarget);
                        
                        if (controllersWithTarget.length === 0) return null;
                        
                        const lowestTargetTemp = Math.min(...controllersWithTarget.map(c => c.target_temp!));
                        const lowestController = controllersWithTarget.find(c => c.target_temp === lowestTargetTemp);
                        const currentTemp = lowestController?.current_temp ?? lowestController?.pill_temp ?? null;
                        console.log('Lowest controller current temp:', currentTemp);
                        return currentTemp;
                      })()}
                      targetTemp={(() => {
                        const followedControllers = availableControllers.filter(c => 
                          followedControllerIds.includes(c.controller_id)
                        );
                        if (followedControllers.length === 0) return null;
                        
                        const controllersWithTarget = followedControllers
                          .filter(c => c.target_temp !== null && c.target_temp !== undefined && c.cooling_enabled === true);
                        
                        if (controllersWithTarget.length === 0) return null;
                        
                        const lowestTargetTemp = Math.min(...controllersWithTarget.map(c => c.target_temp!));
                        console.log('Lowest target temp:', lowestTargetTemp);
                        return lowestTargetTemp;
                      })()}
                      coolingHysteresis={(() => {
                        const followedControllers = availableControllers.filter(c => 
                          followedControllerIds.includes(c.controller_id)
                        );
                        if (followedControllers.length === 0) return null;
                        
                        const controllersWithTarget = followedControllers
                          .filter(c => c.target_temp !== null && c.target_temp !== undefined && c.cooling_enabled === true);
                        
                        if (controllersWithTarget.length === 0) return null;
                        
                        const lowestTargetTemp = Math.min(...controllersWithTarget.map(c => c.target_temp!));
                        const lowestController = controllersWithTarget.find(c => c.target_temp === lowestTargetTemp);
                        return lowestController?.cooling_hysteresis ?? null;
                      })()}
                    />
                  </div>

                  {adjustmentLogs.length > 0 && (
                    <Collapsible>
                      <CollapsibleTrigger className="flex items-center justify-between w-full py-2 hover:text-primary transition-colors">
                        <span className="text-sm font-medium">Justeringshistorik ({adjustmentLogs.length})</span>
                        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200" />
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="max-h-60 overflow-y-auto space-y-2 py-2">
                          {adjustmentLogs.map(log => (
                            <div 
                              key={log.id} 
                              className="border-l-2 border-border pl-3 py-1 text-xs space-y-1"
                            >
                              <div className="flex justify-between items-start">
                                <span className="font-medium text-primary">
                                  {log.cooler_controller_name}
                                </span>
                                <span className="text-muted-foreground">
                                  {new Date(log.created_at).toLocaleString('sv-SE', {
                                    month: 'short',
                                    day: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit'
                                  })}
                                </span>
                              </div>
                              
                              {log.followed_controller_name && (
                                <p className="text-muted-foreground">
                                  {log.followed_controller_name}: <span className="text-destructive">{log.followed_current_temp?.toFixed(1)}°C</span> / Mål: {log.followed_target_temp?.toFixed(1)}°C
                                </p>
                              )}
                              
                              <div className="flex items-center gap-2 text-muted-foreground">
                                <span>Kylare:</span>
                                <span>{log.old_target_temp.toFixed(1)}°C</span>
                                <span>→</span>
                                <span className="text-foreground font-medium">
                                  {log.new_target_temp.toFixed(1)}°C
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  )}

                  <Collapsible>
                    <CollapsibleTrigger className="flex items-center justify-between w-full py-2 hover:text-primary transition-colors">
                      <span className="text-sm font-medium">Beslutslogg (senaste kontroller)</span>
                      <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200" />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="py-2">
                      <AutoCoolingDecisionLogs />
                    </CollapsibleContent>
                  </Collapsible>

                  <div>
                    <label className="text-sm font-medium mb-2 block">Välj kylare</label>
                    <Select value={coolerControllerId} onValueChange={handleCoolerControllerChange}>
                      <SelectTrigger className="w-full bg-card">
                        <SelectValue placeholder="Välj vilken controller som är kylaren" />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-border z-50">
                        {availableControllers.map(controller => (
                          <SelectItem key={controller.id} value={controller.id}>
                            {controller.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">
                      Controller som ska justera sin temperatur
                    </p>
                  </div>

                  {coolerControllerId && (
                    <div>
                      <label className="text-sm font-medium mb-2 block">Följ dessa controllers</label>
                      <div className="space-y-2">
                        {availableControllers
                          .filter(c => c.id !== coolerControllerId)
                          .map(controller => (
                            <div key={controller.id} className="flex items-center space-x-2">
                              <Checkbox
                                id={`follow-${controller.id}`}
                                checked={followedControllerIds.includes(controller.id)}
                                onCheckedChange={(checked) => 
                                  handleFollowedControllerToggle(controller.id, checked as boolean)
                                }
                              />
                              <label
                                htmlFor={`follow-${controller.id}`}
                                className="text-sm cursor-pointer leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                              >
                                {controller.name}
                              </label>
                            </div>
                          ))}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Kylaren kommer att följa dessa controllers måltemperatur
                      </p>
                    </div>
                  )}

                  <div>
                    <label className="text-sm font-medium mb-2 block">Kontrollintervall</label>
                    <Select value={autoCoolingInterval} onValueChange={handleAutoCoolingIntervalChange}>
                      <SelectTrigger className="w-full bg-card">
                        <SelectValue placeholder="Välj intervall" />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-border z-50">
                        <SelectItem value="30">30 minuter</SelectItem>
                        <SelectItem value="60">1 timme</SelectItem>
                        <SelectItem value="90">1.5 timmar</SelectItem>
                        <SelectItem value="120">2 timmar</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">
                      Hur länge temperaturen ska vara stilla innan justering
                    </p>
                  </div>

                  <div>
                    <label className="text-sm font-medium mb-2 block">Temperatursänkning (°C)</label>
                    <Select value={tempReduction} onValueChange={handleTempReductionChange}>
                      <SelectTrigger className="w-full bg-card">
                        <SelectValue placeholder="Välj sänkning" />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-border z-50">
                        <SelectItem value="1">1°C</SelectItem>
                        <SelectItem value="1.5">1.5°C</SelectItem>
                        <SelectItem value="2">2°C</SelectItem>
                        <SelectItem value="2.5">2.5°C</SelectItem>
                        <SelectItem value="3">3°C</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">
                      Hur mycket måltemperaturen ska sänkas per justering
                    </p>
                  </div>

                  <div>
                    <label className="text-sm font-medium mb-2 block">Max differens mot lägsta (°C)</label>
                    <Select value={maxDiffFromLowest} onValueChange={handleMaxDiffChange}>
                      <SelectTrigger className="w-full bg-card">
                        <SelectValue placeholder="Välj max differens" />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-border z-50">
                        <SelectItem value="5">5°C</SelectItem>
                        <SelectItem value="7.5">7.5°C</SelectItem>
                        <SelectItem value="10">10°C</SelectItem>
                        <SelectItem value="12.5">12.5°C</SelectItem>
                        <SelectItem value="15">15°C</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">
                      Max antal grader lägre än den följda controllern med lägst temperatur
                    </p>
                  </div>

                  <Collapsible className="bg-muted/50 rounded-lg">
                    <CollapsibleTrigger className="flex items-center justify-between w-full p-3 hover:bg-muted/70 transition-colors">
                      <span className="font-medium text-foreground text-xs">Hur det fungerar</span>
                      <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 [&[data-state=open]]:rotate-180" />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="px-3 pb-3 text-xs text-muted-foreground space-y-1">
                      <p>• Systemet övervakar den följda controllern med lägst måltemperatur</p>
                      <p>• När denna controllers nuvarande temperatur är över mål + tolerans (kyla aktiv) startar nedräkningen</p>
                      <p>• Efter {autoCoolingInterval} min med aktiv kyla sänks kylarens måltemperatur med {tempReduction}°C</p>
                      <p>• Om kylaren blir mer än 10°C kallare än lägsta controller höjs den automatiskt</p>
                      <p>• Om ingen controller har aktiv kyla sätts kylaren till 18°C</p>
                      <p>• Max {maxDiffFromLowest}°C lägre än lägsta följda controller</p>
                      <p>• Kylaren sätts aldrig utanför sitt min/max-intervall från RAPT</p>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-bold">Fermenteringsprofiler</h2>
                <p className="text-sm text-muted-foreground">
                  Skapa och hantera temperaturschemat för fermenteringen.
                </p>
              </div>
              <FermentationProfilesManagement />
            </div>
            {/* Brew Timer Section */}
            <div className="space-y-4 pt-4 border-t border-border">
              <div>
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Timer className="h-5 w-5" />
                  Brygg-timer synkronisering
                </h2>
                <p className="text-sm text-muted-foreground">
                  Visa aktiv timer från brygg-appen i sidfoten
                </p>
              </div>
              
              <Card className="p-4">
                {externalLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Laddar...
                  </div>
                ) : isExternalAuthenticated ? (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-green-500/10">
                        <Check className="h-4 w-4 text-green-500" />
                      </div>
                      <div>
                        <p className="font-medium">Ansluten</p>
                        <p className="text-sm text-muted-foreground">{externalUser?.email}</p>
                      </div>
                    </div>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => externalSignOut()}
                    >
                      Koppla från
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">Inte ansluten</p>
                      <p className="text-sm text-muted-foreground">
                        Anslut för att visa aktiva timers från brygg-appen
                      </p>
                    </div>
                    <Button onClick={() => setExternalLoginDialogOpen(true)}>
                      Anslut
                    </Button>
                  </div>
                )}
              </Card>
              
              {isExternalAuthenticated && (
                <Card className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Tv className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <p className="font-medium">Endast TV-läge</p>
                        <p className="text-sm text-muted-foreground">
                          Visa timern bara när ?tv=true är i URL:en
                        </p>
                      </div>
                    </div>
                    <Switch
                      checked={timerTvModeOnly}
                      disabled={settingsLoading}
                      onCheckedChange={(checked) => {
                        setTimerTvModeOnly(checked);
                      }}
                    />
                  </div>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* DEVICES TAB */}
          <TabsContent value="devices" className="space-y-6">
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-bold">RAPT Pills</h2>
                <p className="text-sm text-muted-foreground">
                  Välj vilka Pills som ska visas på dashboarden
                </p>
              </div>
              <RaptPillsManagement />
            </div>

            <div className="space-y-4 pt-4 border-t border-border">
              <div>
                <h2 className="text-xl font-bold">Temperature Controllers</h2>
                <p className="text-sm text-muted-foreground">
                  Välj vilka Temperature Controllers som ska visas på dashboarden
                </p>
              </div>
              <RaptControllersManagement />
            </div>
          </TabsContent>

          {/* BREWS TAB */}
          <TabsContent value="brews">
            <BrewManagement />
          </TabsContent>
        </Tabs>
      </div>
      
      <ExternalLoginDialog 
        open={externalLoginDialogOpen} 
        onOpenChange={setExternalLoginDialogOpen} 
      />
    </div>
  );
}
