import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useToast } from "@/hooks/use-toast";

export interface ControllerData {
  id: string;
  controller_id: string;
  name: string;
  current_temp: number | null;
  pill_temp: number | null;
  target_temp: number | null;
  last_update: string | null;
  cooling_enabled: boolean;
  heating_enabled: boolean;
  heating_utilisation: number;
  min_target_temp: number | null;
  max_target_temp: number | null;
  linked_pill_id: string | null;
  cooling_hysteresis: number | null;
  heating_hysteresis: number | null;
  is_glycol_cooler: boolean;
}

export interface SelectedController {
  id: string;
  controller_id: string;
  is_visible: boolean;
  display_order: number;
}

export interface PillData {
  pill_id: string;
  name: string;
  color: string;
  last_update: string | null;
}

export function useControllersManagement() {
  const [controllers, setControllers] = useState<ControllerData[]>([]);
  const [pills, setPills] = useState<PillData[]>([]);
  const [selectedControllers, setSelectedControllers] = useState<Record<string, boolean>>({});
  const [selectedControllersData, setSelectedControllersData] = useState<SelectedController[]>([]);
  const [coolerControllerId, setCoolerControllerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingLimitsId, setEditingLimitsId] = useState<string | null>(null);
  const [tempMinTemp, setTempMinTemp] = useState("");
  const [tempMaxTemp, setTempMaxTemp] = useState("");
  const [updating, setUpdating] = useState(false);
  const [syncInterval, setSyncInterval] = useState<number>(300);
  const { toast } = useToast();
  const isLocalChange = useRef(false);

  const loadData = useCallback(async () => {
    try {
      const { data: selectedData, error: selectedError } = await supabase
        .from('selected_rapt_temp_controllers')
        .select('*')
        .order('display_order');

      if (selectedError) throw selectedError;

      setSelectedControllersData(selectedData || []);
      const selectedControllerIds = selectedData?.map(s => s.controller_id) || [];

      if (selectedControllerIds.length === 0) {
        setControllers([]);
        setLoading(false);
        return;
      }

      const { data: controllersData, error: controllersError } = await supabase
        .from('rapt_temp_controllers')
        .select('*')
        .in('controller_id', selectedControllerIds);

      if (controllersError) throw controllersError;

      const sortedControllers = (controllersData || []).sort((a, b) => {
        const aIndex = selectedControllerIds.indexOf(a.controller_id);
        const bIndex = selectedControllerIds.indexOf(b.controller_id);
        return aIndex - bIndex;
      }).map(c => ({
        ...c,
        is_glycol_cooler: c.is_glycol_cooler ?? false,
      })) as ControllerData[];

      setControllers(sortedControllers);

      const { data: pillsData } = await supabase
        .from('rapt_pills')
        .select('pill_id, name, color, last_update');
      setPills(pillsData || []);

      const { data: syncData } = await supabase
        .from('sync_settings')
        .select('rapt_sync_interval')
        .limit(1)
        .maybeSingle();
      if (syncData) setSyncInterval(syncData.rapt_sync_interval);

      const coolerCtrl = sortedControllers.find(c => c.is_glycol_cooler);
      setCoolerControllerId(coolerCtrl?.controller_id || null);

      const selectedMap: Record<string, boolean> = {};
      sortedControllers.forEach(controller => {
        const selected = selectedData?.find(s => s.controller_id === controller.controller_id);
        selectedMap[controller.controller_id] = selected?.is_visible ?? false;
      });
      setSelectedControllers(selectedMap);
    } catch (error) {
      console.error('Error loading controllers:', error);
      toast({
        title: "Fel",
        description: "Kunde inte ladda Temperature Controllers",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Realtime subscriptions
  useEffect(() => {
    loadData();

    const channel = supabase
      .channel('rapt_temp_controllers_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rapt_temp_controllers' }, () => {
        if (!isLocalChange.current) {
          toast({ title: "Uppdatering från annan enhet", description: "Controller-data har uppdaterats" });
        }
        isLocalChange.current = false;
        loadData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'selected_rapt_temp_controllers' }, () => {
        if (!isLocalChange.current) {
          toast({ title: "Uppdatering från annan enhet", description: "Controller-inställningar har ändrats" });
        }
        isLocalChange.current = false;
        loadData();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sync_settings' }, (payload) => {
        const newData = payload.new as Tables<'sync_settings'>;
        if (newData?.rapt_sync_interval) {
          setSyncInterval(newData.rapt_sync_interval);
          if (!isLocalChange.current) {
            toast({ title: "Uppdatering från annan enhet", description: "Synkroniseringsinställningar har ändrats" });
          }
          isLocalChange.current = false;
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [toast, loadData]);

  const handleToggleController = useCallback(async (controllerId: string, visible: boolean) => {
    try {
      isLocalChange.current = true;
      const { data: existing } = await supabase
        .from('selected_rapt_temp_controllers')
        .select('id')
        .eq('controller_id', controllerId)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from('selected_rapt_temp_controllers')
          .update({ is_visible: visible })
          .eq('controller_id', controllerId);
        if (error) throw error;
      } else {
        const maxOrder = Math.max(...selectedControllersData.map(c => c.display_order), 0);
        const { error } = await supabase
          .from('selected_rapt_temp_controllers')
          .insert({ controller_id: controllerId, is_visible: visible, display_order: maxOrder + 1 });
        if (error) throw error;
      }

      setSelectedControllers(prev => ({ ...prev, [controllerId]: visible }));
      loadData();

      toast({
        title: "Inställning sparad",
        description: `${controllers.find(c => c.controller_id === controllerId)?.name} ${visible ? 'visas nu' : 'är dold'}`,
      });
    } catch (error) {
      console.error('Error updating controller visibility:', error);
      toast({ title: "Fel", description: "Kunde inte spara inställning", variant: "destructive" });
    }
  }, [selectedControllersData, controllers, loadData, toast]);

  const handleMoveUp = useCallback(async (controllerId: string) => {
    const currentIndex = selectedControllersData.findIndex(c => c.controller_id === controllerId);
    if (currentIndex <= 0) return;
    const current = selectedControllersData[currentIndex];
    const previous = selectedControllersData[currentIndex - 1];
    try {
      isLocalChange.current = true;
      await supabase.from('selected_rapt_temp_controllers').update({ display_order: previous.display_order }).eq('controller_id', current.controller_id);
      await supabase.from('selected_rapt_temp_controllers').update({ display_order: current.display_order }).eq('controller_id', previous.controller_id);
      loadData();
    } catch (error) {
      console.error('Error moving controller:', error);
      toast({ title: "Fel", description: "Kunde inte flytta controller", variant: "destructive" });
    }
  }, [selectedControllersData, loadData, toast]);

  const handleMoveDown = useCallback(async (controllerId: string) => {
    const currentIndex = selectedControllersData.findIndex(c => c.controller_id === controllerId);
    if (currentIndex < 0 || currentIndex >= selectedControllersData.length - 1) return;
    const current = selectedControllersData[currentIndex];
    const next = selectedControllersData[currentIndex + 1];
    try {
      isLocalChange.current = true;
      await supabase.from('selected_rapt_temp_controllers').update({ display_order: next.display_order }).eq('controller_id', current.controller_id);
      await supabase.from('selected_rapt_temp_controllers').update({ display_order: current.display_order }).eq('controller_id', next.controller_id);
      loadData();
    } catch (error) {
      console.error('Error moving controller:', error);
      toast({ title: "Fel", description: "Kunde inte flytta controller", variant: "destructive" });
    }
  }, [selectedControllersData, loadData, toast]);

  const handleStartEditLimits = useCallback((controller: ControllerData) => {
    setEditingLimitsId(controller.controller_id);
    setTempMinTemp(controller.min_target_temp?.toString() || "-5");
    setTempMaxTemp(controller.max_target_temp?.toString() || "25");
  }, []);

  const handleCancelEditLimits = useCallback(() => {
    setEditingLimitsId(null);
    setTempMinTemp("");
    setTempMaxTemp("");
  }, []);

  const handleUpdateLimits = useCallback(async (controllerId: string) => {
    const controller = controllers.find(c => c.controller_id === controllerId);
    if (!controller) return;

    const minTemp = parseFloat(tempMinTemp);
    const maxTemp = parseFloat(tempMaxTemp);

    if (isNaN(minTemp) || isNaN(maxTemp)) {
      toast({ title: "Ogiltigt värde", description: "Ange giltiga temperaturer", variant: "destructive" });
      return;
    }
    if (minTemp >= maxTemp) {
      toast({ title: "Ogiltigt intervall", description: "Min temperatur måste vara lägre än max temperatur", variant: "destructive" });
      return;
    }

    setUpdating(true);
    try {
      const { error } = await supabase
        .from('rapt_temp_controllers')
        .update({ min_target_temp: minTemp, max_target_temp: maxTemp })
        .eq('controller_id', controllerId);
      if (error) throw error;

      setControllers(prev => prev.map(c =>
        c.controller_id === controllerId ? { ...c, min_target_temp: minTemp, max_target_temp: maxTemp } : c
      ));
      setEditingLimitsId(null);
      setTempMinTemp("");
      setTempMaxTemp("");
      toast({ title: "Temperaturintervall uppdaterat", description: `${controller.name}: ${minTemp}° till ${maxTemp}°` });
    } catch (error) {
      console.error('Error updating limits:', error);
      toast({ title: "Fel", description: "Kunde inte uppdatera temperaturintervall", variant: "destructive" });
    } finally {
      setUpdating(false);
    }
  }, [controllers, tempMinTemp, tempMaxTemp, toast]);

  const handleLinkPill = useCallback(async (controllerId: string, pillId: string | null) => {
    const controller = controllers.find(c => c.controller_id === controllerId);
    if (!controller) return;

    setUpdating(true);
    try {
      isLocalChange.current = true;
      const { error } = await supabase
        .from('rapt_temp_controllers')
        .update({ linked_pill_id: pillId })
        .eq('controller_id', controllerId);
      if (error) throw error;

      setControllers(prev => prev.map(c =>
        c.controller_id === controllerId ? { ...c, linked_pill_id: pillId } : c
      ));

      const pillName = pillId ? pills.find(p => p.pill_id === pillId)?.name : null;
      toast({
        title: pillId ? "Pill kopplad" : "Pill bortkopplad",
        description: pillId
          ? `${controller.name} är nu kopplad till ${pillName}`
          : `${controller.name} har ingen kopplad pill`,
      });
    } catch (error) {
      console.error('Error linking pill:', error);
      toast({ title: "Fel", description: "Kunde inte uppdatera pill-koppling", variant: "destructive" });
    } finally {
      setUpdating(false);
    }
  }, [controllers, pills, toast]);

  const handleToggleCooler = useCallback(async (controllerId: string) => {
    const isCurrentlyCooler = coolerControllerId === controllerId;
    const newValue = !isCurrentlyCooler;

    setUpdating(true);
    try {
      isLocalChange.current = true;

      if (newValue) {
        await supabase.from('rapt_temp_controllers').update({ is_glycol_cooler: false }).neq('controller_id', controllerId);
      }
      await supabase.from('rapt_temp_controllers').update({ is_glycol_cooler: newValue }).eq('controller_id', controllerId);

      const { data: settings } = await supabase.from('auto_cooling_settings').select('id').limit(1).maybeSingle();
      if (settings) {
        await supabase.from('auto_cooling_settings').update({ cooler_controller_id: newValue ? controllerId : null }).eq('id', settings.id);
      }

      setCoolerControllerId(newValue ? controllerId : null);
      loadData();

      toast({
        title: newValue ? "Glykolkylare markerad" : "Glykolkylare avmarkerad",
        description: `${controllers.find(c => c.controller_id === controllerId)?.name}`,
      });
    } catch (error) {
      console.error('Error toggling cooler:', error);
      toast({ title: "Fel", description: "Kunde inte uppdatera kylare-status", variant: "destructive" });
    } finally {
      setUpdating(false);
    }
  }, [coolerControllerId, controllers, loadData, toast]);

  const getLinkedPillIds = useCallback((excludeControllerId: string): string[] => {
    return controllers
      .filter(c => c.controller_id !== excludeControllerId && c.linked_pill_id)
      .map(c => c.linked_pill_id as string);
  }, [controllers]);

  const handleUpdatePillColor = useCallback(async (pillId: string, color: string) => {
    setUpdating(true);
    try {
      isLocalChange.current = true;
      const { error } = await supabase
        .from('rapt_pills')
        .update({ color })
        .eq('pill_id', pillId);
      if (error) throw error;

      setPills(prev => prev.map(p => p.pill_id === pillId ? { ...p, color } : p));
      toast({ title: "Färg uppdaterad", description: `Pill-färg ändrad` });
    } catch (error) {
      console.error('Error updating pill color:', error);
      toast({ title: "Fel", description: "Kunde inte uppdatera färg", variant: "destructive" });
    } finally {
      setUpdating(false);
    }
  }, [toast]);

  const getSyncIntervalText = useCallback(() => {
    const minutes = Math.floor(syncInterval / 60);
    if (minutes === 1) return "varje minut";
    if (minutes < 60) return `var ${minutes}:e minut`;
    const hours = Math.floor(minutes / 60);
    return `var ${hours}:e timme`;
  }, [syncInterval]);

  return {
    controllers,
    pills,
    selectedControllers,
    selectedControllersData,
    coolerControllerId,
    loading,
    editingLimitsId,
    tempMinTemp,
    setTempMinTemp,
    tempMaxTemp,
    setTempMaxTemp,
    updating,
    handleToggleController,
    handleMoveUp,
    handleMoveDown,
    handleStartEditLimits,
    handleCancelEditLimits,
    handleUpdateLimits,
    handleLinkPill,
    handleToggleCooler,
    getLinkedPillIds,
    getSyncIntervalText,
    handleUpdatePillColor,
  };
}
