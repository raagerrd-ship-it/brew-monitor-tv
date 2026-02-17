import { BrewManagement } from "@/components/BrewManagement";
import { RaptPillsManagement } from "@/components/RaptPillsManagement";
import { RaptControllersManagement } from "@/components/RaptControllersManagement";
import { SyncChecklist } from "@/components/SyncChecklist";
import { AutoCoolingCountdown } from "@/components/AutoCoolingCountdown";
import { AutoCoolingDecisionLogs } from "@/components/AutoCoolingDecisionLogs";
import { FermentationProfilesManagement } from "@/components/fermentation";
import { ExternalLoginDialog } from "@/components/ExternalLoginDialog";
import { SonosSettings } from "@/components/sonos/SonosSettings";
import { DashboardHeader, HEADER_HEIGHT } from "@/components/DashboardHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { useNavigate, useSearchParams } from "react-router-dom";
import { RefreshCw, LogOut, ChevronDown, Thermometer, Cpu, Beer, AlertCircle, Timer, Check, Tv, Snowflake, FlaskConical, Pill, Cloud, Music } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useEffect, useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { User } from "@supabase/supabase-js";
import { useExternalAuth } from "@/contexts/ExternalAuthContext";
import { useExternalUserSettings } from "@/hooks/use-external-user-settings";
import { SettingsSection } from "@/components/ui/settings-section";
import { TempController } from "@/types/brew";

export default function Settings() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const isMobile = useIsMobile();
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
    cooling_hysteresis: number | null,
    linked_pill_id: string | null
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
  const [headerPillsData, setHeaderPillsData] = useState<Array<{
    pill_id: string;
    color: string;
    name: string;
    battery_level: number;
    last_update: string | null;
  }>>([]);
  
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

  const headerPills = headerPillsData;

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
    loadHeaderPills();
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
        () => {
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
                      cooling_hysteresis: updatedController.cooling_hysteresis,
                      linked_pill_id: updatedController.linked_pill_id ?? c.linked_pill_id
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
                  cooling_hysteresis: newData.cooling_hysteresis ?? updated[index].cooling_hysteresis,
                  linked_pill_id: newData.linked_pill_id ?? updated[index].linked_pill_id
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
          .select('controller_id, name, current_temp, pill_temp, target_temp, cooling_enabled, cooling_hysteresis, linked_pill_id')
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
            cooling_hysteresis: c.cooling_hysteresis,
            linked_pill_id: c.linked_pill_id
          })));
        }
      }
    } catch (error) {
      console.error('Error loading available controllers:', error);
    }
  };

  const loadHeaderPills = async () => {
    try {
      const { data: selected } = await supabase
        .from('selected_rapt_pills')
        .select('pill_id')
        .eq('is_visible', true);

      if (selected && selected.length > 0) {
        const pillIds = selected.map(s => s.pill_id);
        const { data: pills } = await supabase
          .from('rapt_pills')
          .select('pill_id, color, name, battery_level, last_update')
          .in('pill_id', pillIds);

        if (pills) {
          setHeaderPillsData(pills);
        }
      }
    } catch (error) {
      console.error('Error loading header pills:', error);
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
    <div className={`bg-gradient-to-br from-background via-background to-primary/5 ${isMobile ? 'min-h-screen' : 'h-full flex flex-col'}`}>
      <DashboardHeader
        controllers={headerControllers}
        pills={headerPills}
        onLogout={handleLogout}
      />
      <div className={isMobile ? '' : 'flex-1 overflow-y-auto'} style={isMobile ? { paddingTop: `${headerControllers.length > 0 ? 136 : 72}px` } : undefined}>
        <div className="w-full px-4 sm:px-6 lg:px-8 pb-8 pt-4">
        
        <Tabs value={initialTab} onValueChange={handleTabChange} className="w-full">
          <TabsList className="grid w-full grid-cols-4 mb-6">
            <TabsTrigger value="sync" className="flex items-center gap-2 relative">
              <RefreshCw className="h-4 w-4" />
              Synk
              {syncTabStatus && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] text-destructive-foreground">
                  <AlertCircle className="h-3 w-3" />
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="automation" className="flex items-center gap-2 relative">
              <Thermometer className="h-4 w-4" />
              Automatik
              {automationTabStatus && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] text-destructive-foreground">
                  <AlertCircle className="h-3 w-3" />
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="devices" className="flex items-center gap-2 relative">
              <Cpu className="h-4 w-4" />
              Enheter
              {devicesTabStatus && (
                <Badge className="absolute -top-2 -right-2 h-5 min-w-5 px-1 text-[10px] flex items-center justify-center bg-green-600 text-white hover:bg-green-600">
                  {devicesTabStatus.count}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="brews" className="flex items-center gap-2 relative">
              <Beer className="h-4 w-4" />
              Öl
              {brewsTabStatus && (
                <Badge className="absolute -top-2 -right-2 h-5 min-w-5 px-1 text-[10px] flex items-center justify-center bg-green-600 text-white hover:bg-green-600">
                  {brewsTabStatus.count}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* SYNC TAB */}
          <TabsContent value="sync" className="space-y-8">
            <SettingsSection
              icon={Beer}
              title="Brewfather"
              description="Synkronisera bryggar-data från Brewfather"
            >
              <Card className="p-4 bg-muted/30 border-primary/10">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">API-uppgifter</span>
                    {apiSettings?.brewfather?.configured ? (
                      <span className="flex items-center gap-1 text-[10px] text-green-500">
                        <Check className="h-3 w-3" /> Konfigurerad
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[10px] text-amber-500">
                        <AlertCircle className="h-3 w-3" /> Saknas
                      </span>
                    )}
                  </div>
                  
                  {apiSettings?.brewfather && (
                    <div className="text-xs space-y-1 p-2 rounded bg-background/50">
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
                  
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        toast({
                          title: "Uppdatera Brewfather-uppgifter",
                          description: "Be AI-assistenten i chatten att uppdatera ditt Brewfather User ID",
                        });
                      }}
                      className="flex-1 h-8 text-xs"
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
                      className="flex-1 h-8 text-xs"
                    >
                      Uppdatera API-nyckel
                    </Button>
                  </div>
                </div>
              </Card>

              {/* Sync Options Grid */}
              <div className="grid gap-4 grid-cols-2">
                {/* Quick Sync Card */}
                <Card className="p-4 space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold">Snabb synk</h3>
                    <p className="text-xs text-muted-foreground">Löpande data för synliga öl</p>
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">Frekvens</label>
                    <Select value={syncInterval} onValueChange={handleSyncIntervalChange}>
                      <SelectTrigger className="w-full bg-background h-9">
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
                    <p className="text-[11px] text-muted-foreground">
                      Senast: {new Date(lastBrewfatherQuickSync).toLocaleString("sv-SE", {
                        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                      })}
                    </p>
                  )}

                  <Button
                    onClick={handleQuickSync} 
                    disabled={quickSyncing}
                    className="w-full"
                    variant="outline"
                    size="sm"
                  >
                    <RefreshCw className={`mr-2 h-3 w-3 ${quickSyncing ? 'animate-spin' : ''}`} />
                    {quickSyncing ? 'Synkar...' : 'Kör nu'}
                  </Button>
                </Card>

                {/* Full Sync Card */}
                <Card className="p-4 space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold">Full synk</h3>
                    <p className="text-xs text-muted-foreground">Komplett data + auto-synlighet</p>
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">Frekvens</label>
                    <Select value={fullSyncInterval} onValueChange={handleFullSyncIntervalChange}>
                      <SelectTrigger className="w-full bg-background h-9">
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
                  
                  {lastFullSync && (
                    <p className="text-[11px] text-muted-foreground">
                      Senast: {new Date(lastFullSync).toLocaleString("sv-SE", {
                        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                      })}
                    </p>
                  )}

                  <Button 
                    onClick={handleFullSync} 
                    disabled={syncing}
                    className="w-full"
                    size="sm"
                  >
                    <RefreshCw className={`mr-2 h-3 w-3 ${syncing ? 'animate-spin' : ''}`} />
                    {syncing ? 'Synkar...' : 'Kör nu'}
                  </Button>

                  {syncing && syncSteps.length > 0 && (
                    <SyncChecklist steps={syncSteps} />
                  )}
                </Card>
              </div>

              {/* Auto Settings */}
              <Card className="p-4 space-y-3">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Automatisk hantering</span>
                
                <div className="grid gap-2 grid-cols-2">
                  <div className="flex items-center space-x-2 p-2 rounded-md bg-muted/30">
                    <Checkbox 
                      id="auto-activate-fermenting"
                      checked={autoActivateFermenting}
                      onCheckedChange={(checked) => handleAutoSettingChange('auto_activate_fermenting', !!checked)}
                    />
                    <label htmlFor="auto-activate-fermenting" className="text-xs cursor-pointer">
                      Visa nya jäsande öl
                    </label>
                  </div>
                  
                  <div className="flex items-center space-x-2 p-2 rounded-md bg-muted/30">
                    <Checkbox 
                      id="auto-hide-completed"
                      checked={autoHideCompleted}
                      onCheckedChange={(checked) => handleAutoSettingChange('auto_hide_completed', !!checked)}
                    />
                    <label htmlFor="auto-hide-completed" className="text-xs cursor-pointer">
                      Dölj klara öl
                    </label>
                  </div>

                  <div className="flex items-center space-x-2 p-2 rounded-md bg-muted/30">
                    <Checkbox 
                      id="auto-hide-conditioning"
                      checked={autoHideConditioning}
                      onCheckedChange={(checked) => handleAutoSettingChange('auto_hide_conditioning', !!checked)}
                    />
                    <label htmlFor="auto-hide-conditioning" className="text-xs cursor-pointer">
                      Dölj konditionerade öl
                    </label>
                  </div>

                  <div className="flex items-center space-x-2 p-2 rounded-md bg-muted/30">
                    <Checkbox 
                      id="auto-hide-archived"
                      checked={autoHideArchived}
                      onCheckedChange={(checked) => handleAutoSettingChange('auto_hide_archived', !!checked)}
                    />
                    <label htmlFor="auto-hide-archived" className="text-xs cursor-pointer">
                      Dölj arkiverade öl
                    </label>
                  </div>
                </div>
              </Card>
            </SettingsSection>

            <SettingsSection
              icon={Cloud}
              title="RAPT"
              description="Synkronisera enheter från RAPT Portal"
            >
              <Card className="p-4 bg-muted/30 border-primary/10">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">API-uppgifter</span>
                    {apiSettings?.rapt?.configured ? (
                      <span className="flex items-center gap-1 text-[10px] text-green-500">
                        <Check className="h-3 w-3" /> Konfigurerad
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[10px] text-amber-500">
                        <AlertCircle className="h-3 w-3" /> Saknas
                      </span>
                    )}
                  </div>
                  
                  {apiSettings?.rapt && (
                    <div className="text-xs space-y-1 p-2 rounded bg-background/50">
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
                  
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        toast({
                          title: "Uppdatera RAPT-uppgifter",
                          description: "Be AI-assistenten i chatten att uppdatera ditt RAPT-användarnamn",
                        });
                      }}
                      className="flex-1 h-8 text-xs"
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
                      className="flex-1 h-8 text-xs"
                    >
                      Uppdatera API-nyckel
                    </Button>
                  </div>
                </div>
              </Card>

              {/* Sync Options Grid */}
              <div className="grid gap-4 grid-cols-2">
                {/* Quick Sync Card */}
                <Card className="p-4 space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold">Snabb synk</h3>
                    <p className="text-xs text-muted-foreground">Data för valda enheter</p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">Frekvens</label>
                    <Select value={raptSyncInterval} onValueChange={handleRaptSyncIntervalChange}>
                      <SelectTrigger className="w-full bg-background h-9">
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
                    <p className="text-[11px] text-muted-foreground">
                      Senast: {new Date(lastRaptQuickSync).toLocaleString("sv-SE", {
                        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                      })}
                    </p>
                  )}

                  <Button
                    onClick={handleRaptQuickSync} 
                    disabled={raptQuickSyncing}
                    className="w-full"
                    variant="outline"
                    size="sm"
                  >
                    <RefreshCw className={`mr-2 h-3 w-3 ${raptQuickSyncing ? 'animate-spin' : ''}`} />
                    {raptQuickSyncing ? 'Synkar...' : 'Kör nu'}
                  </Button>
                </Card>

                {/* Full Sync Card */}
                <Card className="p-4 space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold">Full synk</h3>
                    <p className="text-xs text-muted-foreground">Hämtar alla enheter</p>
                  </div>
                  
                  {lastRaptSync && (
                    <p className="text-[11px] text-muted-foreground">
                      Senast: {new Date(lastRaptSync).toLocaleString("sv-SE", {
                        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                      })}
                    </p>
                  )}

                  <Button
                    onClick={handleRaptFullSync} 
                    disabled={raptSyncing}
                    className="w-full"
                    size="sm"
                  >
                    <RefreshCw className={`mr-2 h-3 w-3 ${raptSyncing ? 'animate-spin' : ''}`} />
                    {raptSyncing ? 'Synkar...' : 'Kör nu'}
                  </Button>

                  {raptSyncing && raptSyncSteps.length > 0 && (
                    <SyncChecklist steps={raptSyncSteps} />
                  )}
                </Card>
              </div>
            </SettingsSection>

            <SettingsSection
              icon={Tv}
              title="TV-läge"
              description="Fjärrstyr anslutna TV-enheter"
            >
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  await supabase
                    .from('sync_settings')
                    .update({ force_tv_refresh_at: new Date().toISOString() })
                    .not('id', 'is', null);
                  toast({ title: "TV-uppdatering skickad", description: "Alla TV-enheter laddas om inom kort." });
                }}
              >
                <Tv className="h-4 w-4 mr-2" />
                Uppdatera TV:ar
              </Button>
            </SettingsSection>

            <SettingsSection
              icon={Timer}
              title="Brygg-timer synkronisering"
              description="Visa aktiv timer från brygg-appen i sidfoten"
            >
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
            </SettingsSection>

            <SettingsSection
              icon={Music}
              title="Sonos"
              description="Visa vad som spelas på Sonos i headern"
            >
              <SonosSettings />
            </SettingsSection>
          </TabsContent>

          {/* AUTOMATION TAB */}
          <TabsContent value="automation" className="space-y-6">
            <SettingsSection
              icon={Snowflake}
              title="Automatisk Kylreglering"
              description="Justerar automatiskt måltemperaturen om kylaren inte får ner temperaturen"
            >
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
                <div className="space-y-6">
                  {/* STATUS SECTION */}
                  <Card className="p-4 bg-muted/30 border-primary/20">
                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                        <h3 className="text-sm font-semibold">Status</h3>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        {/* Cooler Status */}
                        <div className="space-y-1 p-3 rounded-lg bg-background/50">
                          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Kylare</span>
                          <p className="font-medium text-sm">
                            {coolerControllerId 
                              ? availableControllers.find(c => c.id === coolerControllerId)?.name || 'Ej vald'
                              : 'Ej vald'}
                          </p>
                          {coolerControllerId && (() => {
                            const cooler = availableControllers.find(c => c.id === coolerControllerId);
                            const current = cooler?.current_temp !== null && cooler?.current_temp !== undefined
                              ? Number(cooler.current_temp).toFixed(1) : null;
                            const target = cooler?.target_temp !== null && cooler?.target_temp !== undefined
                              ? Number(cooler.target_temp).toFixed(1) : null;
                            return current || target ? (
                              <div className="text-xs text-muted-foreground mt-1">
                                {current && <span>{current}°C</span>}
                                {current && target && <span className="mx-1">→</span>}
                                {target && <span className="text-foreground">{target}°C mål</span>}
                              </div>
                            ) : null;
                          })()}
                        </div>

                        {/* Followed Controller Status */}
                        <div className="space-y-1 p-3 rounded-lg bg-background/50">
                          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Följer</span>
                          {(() => {
                            const followedControllers = availableControllers.filter(c => 
                              followedControllerIds.includes(c.id) && c.cooling_enabled === true
                            );
                            if (followedControllers.length === 0) return <p className="font-medium text-sm">Ingen aktiv</p>;
                            
                            const controllersWithTarget = followedControllers
                              .filter(c => c.target_temp !== null && c.target_temp !== undefined);
                            
                            if (controllersWithTarget.length === 0) return <p className="font-medium text-sm">Ingen aktiv</p>;
                            
                            const lowestTargetTemp = Math.min(...controllersWithTarget.map(c => c.target_temp!));
                            const lowestController = controllersWithTarget.find(c => c.target_temp === lowestTargetTemp);
                            const currentTemp = lowestController?.current_temp ?? lowestController?.pill_temp;
                            const hysteresis = lowestController?.cooling_hysteresis ?? 0.2;
                            
                            return (
                              <>
                                <p className="font-medium text-sm">{lowestController?.name || 'N/A'}</p>
                                <div className="text-xs text-muted-foreground mt-1">
                                  {currentTemp !== null && currentTemp !== undefined && (
                                    <span>{Number(currentTemp).toFixed(1)}°C</span>
                                  )}
                                  <span className="mx-1">→</span>
                                  <span className="text-foreground">{lowestTargetTemp.toFixed(1)}°C mål</span>
                                  <span className="text-muted-foreground/70 ml-1">(±{hysteresis.toFixed(1)}°)</span>
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      </div>

                      {/* Countdown */}
                      <div className="flex items-center justify-between pt-2 border-t border-border/50">
                        <span className="text-sm text-muted-foreground">Nästa kontroll</span>
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
                            if (followedControllers.length === 0) return null;
                            const controllersWithTarget = followedControllers
                              .filter(c => c.target_temp !== null && c.target_temp !== undefined && c.cooling_enabled === true);
                            if (controllersWithTarget.length === 0) return null;
                            const lowestTargetTemp = Math.min(...controllersWithTarget.map(c => c.target_temp!));
                            const lowestController = controllersWithTarget.find(c => c.target_temp === lowestTargetTemp);
                            return lowestController?.current_temp ?? lowestController?.pill_temp ?? null;
                          })()}
                          targetTemp={(() => {
                            const followedControllers = availableControllers.filter(c => 
                              followedControllerIds.includes(c.controller_id)
                            );
                            if (followedControllers.length === 0) return null;
                            const controllersWithTarget = followedControllers
                              .filter(c => c.target_temp !== null && c.target_temp !== undefined && c.cooling_enabled === true);
                            if (controllersWithTarget.length === 0) return null;
                            return Math.min(...controllersWithTarget.map(c => c.target_temp!));
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
                    </div>
                  </Card>

                  {/* CONTROLLER CONFIGURATION */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <Cpu className="h-4 w-4 text-muted-foreground" />
                      Controllers
                    </h3>
                    
                    <div className="grid gap-4 grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">Kylare (justeras)</label>
                        <Select value={coolerControllerId} onValueChange={handleCoolerControllerChange}>
                          <SelectTrigger className="w-full bg-card">
                            <SelectValue placeholder="Välj kylare..." />
                          </SelectTrigger>
                          <SelectContent className="bg-card border-border z-50">
                            {availableControllers.map(controller => (
                              <SelectItem key={controller.id} value={controller.id}>
                                {controller.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {coolerControllerId && (
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-muted-foreground">Följ (övervakas)</label>
                          <div className="p-3 rounded-md bg-card border border-border space-y-2">
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
                                    className="text-sm cursor-pointer"
                                  >
                                    {controller.name}
                                  </label>
                                </div>
                              ))}
                            {availableControllers.filter(c => c.id !== coolerControllerId).length === 0 && (
                              <p className="text-xs text-muted-foreground italic">Inga andra controllers tillgängliga</p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* PARAMETERS */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <Thermometer className="h-4 w-4 text-muted-foreground" />
                      Justeringsparametrar
                    </h3>
                    
                    <div className="grid gap-4 grid-cols-3">
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">Kontrollintervall</label>
                        <Select value={autoCoolingInterval} onValueChange={handleAutoCoolingIntervalChange}>
                          <SelectTrigger className="w-full bg-card">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-card border-border z-50">
                            <SelectItem value="30">30 min</SelectItem>
                            <SelectItem value="60">1 timme</SelectItem>
                            <SelectItem value="90">1.5 tim</SelectItem>
                            <SelectItem value="120">2 timmar</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">Sänkning per steg</label>
                        <Select value={tempReduction} onValueChange={handleTempReductionChange}>
                          <SelectTrigger className="w-full bg-card">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-card border-border z-50">
                            <SelectItem value="1">1°C</SelectItem>
                            <SelectItem value="1.5">1.5°C</SelectItem>
                            <SelectItem value="2">2°C</SelectItem>
                            <SelectItem value="2.5">2.5°C</SelectItem>
                            <SelectItem value="3">3°C</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">Max differens</label>
                        <Select value={maxDiffFromLowest} onValueChange={handleMaxDiffChange}>
                          <SelectTrigger className="w-full bg-card">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-card border-border z-50">
                            <SelectItem value="5">5°C</SelectItem>
                            <SelectItem value="7.5">7.5°C</SelectItem>
                            <SelectItem value="10">10°C</SelectItem>
                            <SelectItem value="12.5">12.5°C</SelectItem>
                            <SelectItem value="15">15°C</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Sänker {tempReduction}°C var {autoCoolingInterval} min. Max {maxDiffFromLowest}°C under lägsta följda controller.
                    </p>
                  </div>

                  {/* HISTORY */}
                  <Collapsible>
                    <CollapsibleTrigger className="flex items-center justify-between w-full py-2 hover:text-primary transition-colors group">
                      <span className="text-sm font-semibold">Justeringshistorik</span>
                      <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-2">
                      <AutoCoolingDecisionLogs />
                    </CollapsibleContent>
                  </Collapsible>

                  {/* INFO */}
                  <Collapsible className="bg-muted/30 rounded-lg border border-border/50">
                    <CollapsibleTrigger className="flex items-center justify-between w-full p-3 hover:bg-muted/50 transition-colors text-left group">
                      <span className="text-xs font-medium text-muted-foreground">Hur fungerar det?</span>
                      <ChevronDown className="h-3 w-3 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="px-3 pb-3 text-xs text-muted-foreground space-y-1">
                      <p>• Övervakar controller med lägst måltemperatur</p>
                      <p>• Startar nedräkning när temperaturen är över mål + tolerans</p>
                      <p>• Sänker kylarens mål efter {autoCoolingInterval} min med {tempReduction}°C</p>
                      <p>• Höjer automatiskt om kylaren blir &gt;10°C kallare</p>
                      <p>• Sätter kylaren till 18°C om ingen controller kyler aktivt</p>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              )}
            </SettingsSection>

            <SettingsSection
              icon={FlaskConical}
              title="Fermenteringsprofiler"
              description="Skapa och hantera temperaturschemat för fermenteringen"
            >
              <FermentationProfilesManagement />
            </SettingsSection>

          </TabsContent>

          {/* DEVICES TAB */}
          <TabsContent value="devices" className="space-y-6">
            <SettingsSection
              icon={Thermometer}
              title="Temperature Controllers"
              description="Välj vilka Temperature Controllers som ska visas på dashboarden"
            >
              <RaptControllersManagement />
            </SettingsSection>

            <SettingsSection
              icon={Pill}
              title="RAPT Pills"
              description="Ej kopplade pills som kan visas separat på dashboarden"
            >
              <RaptPillsManagement />
            </SettingsSection>
          </TabsContent>

          {/* BREWS TAB */}
          <TabsContent value="brews">
            <BrewManagement />
          </TabsContent>
        </Tabs>
        </div>
      </div>
      
      <ExternalLoginDialog 
        open={externalLoginDialogOpen} 
        onOpenChange={setExternalLoginDialogOpen} 
      />
    </div>
  );
}
