import { BrewManagement } from "@/components/BrewManagement";
import { RaptPillsManagement } from "@/components/RaptPillsManagement";
import { RaptControllersManagement } from "@/components/RaptControllersManagement";
import { SyncChecklist } from "@/components/SyncChecklist";
import { AutoCoolingCountdown } from "@/components/AutoCoolingCountdown";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, RefreshCw, LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { User } from "@supabase/supabase-js";

export default function Settings() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncInterval, setSyncInterval] = useState<string>("60");
  const [syncing, setSyncing] = useState(false);
  const [quickSyncing, setQuickSyncing] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [autoHideCompleted, setAutoHideCompleted] = useState(true);
  const [autoHideConditioning, setAutoHideConditioning] = useState(true);
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
    name: string, 
    current_temp: number | null,
    pill_temp: number | null,
    target_temp: number | null,
    cooling_enabled: boolean | null
  }>>([]);
  const [adjustmentLogs, setAdjustmentLogs] = useState<Array<{
    id: string;
    created_at: string;
    cooler_controller_name: string;
    old_target_temp: number;
    new_target_temp: number;
    lowest_followed_temp: number;
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
                      name: updatedController.name,
                      current_temp: updatedController.current_temp,
                      pill_temp: updatedController.pill_temp,
                      target_temp: updatedController.target_temp,
                      cooling_enabled: updatedController.cooling_enabled
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
                  cooling_enabled: newData.cooling_enabled ?? updated[index].cooling_enabled
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
          .select('controller_id, name, current_temp, pill_temp, target_temp, cooling_enabled')
          .in('controller_id', controllerIds);

        if (controllers) {
          setAvailableControllers(controllers.map(c => ({ 
            id: c.controller_id, 
            name: c.name,
            current_temp: c.current_temp,
            pill_temp: c.pill_temp,
            target_temp: c.target_temp,
            cooling_enabled: c.cooling_enabled
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
        
        <Card className="p-6 mb-6">
          <h2 className="text-xl font-bold mb-6">Brewfather inställningar</h2>
          
          <div className="space-y-8">
            <div className="space-y-4 pb-6 border-b">
              <h3 className="text-lg font-semibold mb-4">Brewfather API-uppgifter</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Be AI-assistenten uppdatera dina Brewfather-inloggningsuppgifter i chatten
              </p>
              
              {apiSettings?.brewfather && (
                <div className="bg-muted/50 p-4 rounded-lg space-y-2 mb-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">User ID:</span>
                    <span className="text-sm font-mono">{apiSettings.brewfather.userId}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">API-nyckel:</span>
                    <span className="text-sm font-mono">{apiSettings.brewfather.apiKey}</span>
                  </div>
                </div>
              )}
              
              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  variant="outline"
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
            
            <div className="space-y-4 pb-6 border-b">
              <div>
                <h3 className="text-lg font-semibold mb-1">Snabb synkronisering</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Uppdaterar löpande data för synliga öl
                </p>
                <div className="text-xs text-muted-foreground space-y-1 mb-4 pl-4">
                  <p>• Aktuellt SG (Specific Gravity)</p>
                  <p>• Aktuell temperatur</p>
                  <p>• Batterinivå</p>
                  <p>• Senaste avläsningstidpunkt</p>
                </div>
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

            {lastBrewfatherQuickSync ? (
              <p className="text-sm text-muted-foreground">
                Senaste snabbsynkning:{" "}
                <span className="font-medium text-foreground">
                  {new Date(lastBrewfatherQuickSync).toLocaleString("sv-SE", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                Ingen snabbsynkning har gjorts än
              </p>
            )}

            <div>
              <Button
                onClick={handleQuickSync} 
                disabled={quickSyncing}
                className="w-full"
                variant="outline"
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${quickSyncing ? 'animate-spin' : ''}`} />
                {quickSyncing ? 'Synkroniserar...' : 'Kör snabb synkronisering nu'}
              </Button>
            </div>
            </div>

            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold mb-1">Full synkronisering</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Hämtar komplett data och hanterar automatisk synlighet av öl
                </p>
                <div className="text-xs text-muted-foreground space-y-1 mb-4 pl-4">
                  <p>• Receptinformation (namn, stil, batchnummer)</p>
                  <p>• OG (Original Gravity) och FG (Final Gravity)</p>
                  <p>• Status (jäsning, konditionering, klar)</p>
                  <p>• Alla historiska avläsningar (SG, temperatur, batteri)</p>
                  <p>• Automatisk synlighetshantering baserat på status</p>
                </div>
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

            <div className="space-y-3">
              <h4 className="text-sm font-medium">Automatisk hantering</h4>
              
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="auto-activate-fermenting"
                  checked={autoActivateFermenting}
                  onCheckedChange={(checked) => handleAutoSettingChange('auto_activate_fermenting', !!checked)}
                />
                <label
                  htmlFor="auto-activate-fermenting"
                  className="text-sm cursor-pointer leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Visa nya öl med status Jäsning
                </label>
              </div>
              
              
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="auto-hide-completed"
                  checked={autoHideCompleted}
                  onCheckedChange={(checked) => handleAutoSettingChange('auto_hide_completed', !!checked)}
                />
                <label
                  htmlFor="auto-hide-completed"
                  className="text-sm cursor-pointer leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Dölj öl som är klara
                </label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="auto-hide-conditioning"
                  checked={autoHideConditioning}
                  onCheckedChange={(checked) => handleAutoSettingChange('auto_hide_conditioning', !!checked)}
                />
                <label
                  htmlFor="auto-hide-conditioning"
                  className="text-sm cursor-pointer leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Dölj öl som konditioneras
                </label>
              </div>
            </div>
            
              {lastFullSync ? (
                <p className="text-sm text-muted-foreground">
                  Senaste fullsynkning:{" "}
                  <span className="font-medium text-foreground">
                    {new Date(lastFullSync).toLocaleString("sv-SE", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </p>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  Ingen fullsynkning har gjorts än
                </p>
              )}

              <div>
                <Button 
                  onClick={handleFullSync} 
                  disabled={syncing}
                  className="w-full"
                >
                  <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
                  {syncing ? 'Synkroniserar...' : 'Kör full synkronisering nu'}
                </Button>
              </div>

              {syncing && syncSteps.length > 0 && (
                <SyncChecklist steps={syncSteps} />
              )}
            </div>
          </div>
        </Card>

        <Card className="p-6 mb-6">
          <h2 className="text-xl font-bold mb-6">RAPT Inställningar</h2>
          
          <div className="space-y-6">
            <div className="space-y-4 pb-6 border-b">
              <h3 className="text-lg font-semibold mb-4">RAPT API-uppgifter</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Be AI-assistenten uppdatera dina RAPT Portal-inloggningsuppgifter i chatten
              </p>
              
              {apiSettings?.rapt && (
                <div className="bg-muted/50 p-4 rounded-lg space-y-2 mb-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Användarnamn:</span>
                    <span className="text-sm font-mono">{apiSettings.rapt.username}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">API-nyckel:</span>
                    <span className="text-sm font-mono">{apiSettings.rapt.apiSecret}</span>
                  </div>
                </div>
              )}
              
              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  variant="outline"
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
            <div className="space-y-4 pb-6 border-b">
              <div>
                <h3 className="text-lg font-semibold mb-1">Snabb datasynkning</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Uppdaterar endast data för valda enheter
                </p>
                <div className="text-xs text-muted-foreground space-y-1 mb-4 pl-4">
                  <p>• Batterinivåer för valda Pills</p>
                  <p>• Temperaturer för valda Temperature Controllers</p>
                  <p>• Snabbt och effektivt för frekvent synkning</p>
                </div>
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
              
              {lastRaptQuickSync ? (
                <p className="text-sm text-muted-foreground">
                  Senaste snabbsynkning:{" "}
                  <span className="font-medium text-foreground">
                    {new Date(lastRaptQuickSync).toLocaleString("sv-SE", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </p>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  Ingen snabbsynkning har gjorts än
                </p>
              )}

              <div>
                <Button
                  onClick={handleRaptQuickSync} 
                  disabled={raptQuickSyncing}
                  className="w-full"
                  variant="outline"
                >
                  <RefreshCw className={`mr-2 h-4 w-4 ${raptQuickSyncing ? 'animate-spin' : ''}`} />
                  {raptQuickSyncing ? 'Synkroniserar...' : 'Kör snabbsynkning nu'}
                </Button>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold mb-1">Full enhetssynkning</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Hämtar alla enheter från RAPT
                </p>
                <div className="text-xs text-muted-foreground space-y-1 mb-4 pl-4">
                  <p>• Upptäcker nya Pills och Temperature Controllers</p>
                  <p>• Uppdaterar alla enhetsdata</p>
                  <p>• Körs manuellt när du lägger till ny utrustning</p>
                </div>
              </div>
              
              {lastRaptSync ? (
                <p className="text-sm text-muted-foreground">
                  Senaste fullsynkning:{" "}
                  <span className="font-medium text-foreground">
                    {new Date(lastRaptSync).toLocaleString("sv-SE", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </p>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  Ingen fullsynkning har gjorts än
                </p>
              )}

              <div>
                <Button
                  onClick={handleRaptFullSync} 
                  disabled={raptSyncing}
                  className="w-full"
                >
                  <RefreshCw className={`mr-2 h-4 w-4 ${raptSyncing ? 'animate-spin' : ''}`} />
                  {raptSyncing ? 'Synkroniserar...' : 'Kör fullsynkning nu'}
                </Button>
              </div>

              {raptSyncing && raptSyncSteps.length > 0 && (
                <SyncChecklist steps={raptSyncSteps} />
              )}
            </div>

            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold mb-4">Automatisk Kylreglering</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Justerar automatiskt måltemperaturen om kylaren inte får ner temperaturen
              </p>
              <div className="space-y-4">
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
                  <div className="space-y-4 pl-6 border-l-2 border-border">
                    <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 space-y-2">
                      <p className="text-sm font-medium text-primary">Aktuella inställningar:</p>
                      <div className="grid grid-cols-2 gap-2 text-xs">
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
                            const currentTemp = lowestController?.pill_temp ?? lowestController?.current_temp;
                            
                            return (
                              <div className="font-medium">
                                <div>{currentTemp !== null && currentTemp !== undefined ? `${Number(currentTemp).toFixed(1)}°C` : 'N/A'} (aktuell)</div>
                                <div>{lowestTargetTemp.toFixed(1)}°C (mål)</div>
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    </div>

                    <div className="bg-accent/20 border border-accent/40 rounded-lg p-4">
                      <div className="flex items-center justify-between">
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
                            if (!coolerControllerId) return null;
                            const cooler = availableControllers.find(c => c.id === coolerControllerId);
                            return cooler?.current_temp ?? null;
                          })()}
                          targetTemp={(() => {
                            if (!coolerControllerId) return null;
                            const cooler = availableControllers.find(c => c.id === coolerControllerId);
                            return cooler?.target_temp ?? null;
                          })()}
                        />
                      </div>
                    </div>

                    {adjustmentLogs.length > 0 && (
                      <div className="bg-muted/50 border border-border rounded-lg p-4">
                        <p className="text-sm font-medium mb-3">Justeringshistorik:</p>
                        <div className="max-h-60 overflow-y-auto space-y-2 pr-2">
                          {adjustmentLogs.map(log => (
                            <div 
                              key={log.id} 
                              className="bg-card border border-border rounded p-3 text-xs space-y-1"
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
                              <div className="flex items-center gap-2 text-muted-foreground">
                                <span>Måltemp:</span>
                                <span>{log.old_target_temp.toFixed(1)}°C</span>
                                <span>→</span>
                                <span className="text-foreground font-medium">
                                  {log.new_target_temp.toFixed(1)}°C
                                </span>
                              </div>
                              <p className="text-muted-foreground italic">
                                {log.reason}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

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

                    <div className="bg-muted/50 p-3 rounded-lg text-xs text-muted-foreground space-y-1">
                      <p className="font-medium text-foreground">Hur det fungerar:</p>
                      <p>• Systemet övervakar den följda controllern med lägst måltemperatur</p>
                      <p>• När denna controllers kyla är aktiv (temp {'>'} target) startar nedräkningen</p>
                      <p>• Efter {autoCoolingInterval} min med aktiv kyla sänks kylarens temperatur med {tempReduction}°C</p>
                      <p>• Om kylaren blir mer än 10°C kallare än lägsta controller höjs den automatiskt</p>
                      <p>• Om ingen controller har kyla påslagen sätts kylaren till 18°C</p>
                      <p>• Max {maxDiffFromLowest}°C lägre än lägsta följda controller</p>
                      <p>• Kylaren sätts aldrig utanför sitt min/max-intervall</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold mb-4">RAPT Pills</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Välj vilka Pills som ska visas på dashboarden
              </p>
              <RaptPillsManagement />
            </div>

            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold mb-4">Temperature Controllers</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Välj vilka Temperature Controllers som ska visas på dashboarden
              </p>
              <RaptControllersManagement />
            </div>
          </div>
        </Card>

        <BrewManagement />
      </div>
    </div>
  );
}
