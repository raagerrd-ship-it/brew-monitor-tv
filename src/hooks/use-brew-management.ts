import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import type { PillData, TempController } from '@/types/brew';
import type { CustomBrewData, CustomBrewPrefill } from '@/components/CustomBrewDialog';


export function useBrewManagement() {
  const [customBrews, setCustomBrews] = useState<CustomBrewData[]>([]);
  const [pills, setPills] = useState<PillData[]>([]);
  const [controllers, setControllers] = useState<TempController[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCustomBrewDialog, setShowCustomBrewDialog] = useState(false);
  const [editingBrew, setEditingBrew] = useState<CustomBrewData | null>(null);
  const [prefillData, setPrefillData] = useState<CustomBrewPrefill | null>(null);
  const [timerRecipeName, setTimerRecipeName] = useState<string | null>(null);
  const [timerBeerStyle, setTimerBeerStyle] = useState<string | null>(null);
  const [timerBrewMatch, setTimerBrewMatch] = useState<{
    style?: string;
    description?: string;
    label_image_url?: string;
  } | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    loadData();
    loadTimerData();
  }, [toast]);

  const loadData = async () => {
    try {
      setLoading(true);

      const [customBrewsResponse, pillsResponse, controllersResponse] = await Promise.all([
        supabase.from('brew_readings')
          .select('id, batch_id, name, style, batch_number, original_gravity, final_gravity, volume_l, pi_pending_at, linked_controller_id, linked_pill_id, status, fermentation_start, label_image_url, description, pill_compensation, recipe')
          .like('batch_id', 'custom_%'),
        supabase.from('rapt_pills').select('id, pill_id, name, color, battery_level, last_update, paired_device_id'),
        supabase.from('rapt_temp_controllers')
          .select('id, controller_id, name, current_temp, pill_temp, actual_temp, target_temp, last_update, min_target_temp, max_target_temp, cooling_enabled, heating_enabled, heating_utilisation, linked_pill_id, cooling_hysteresis, heating_hysteresis, cooling_run_time, cooling_starts, heating_run_time, heating_starts')
      ]);

      setCustomBrews(customBrewsResponse.data || []);
      setPills(pillsResponse.data || []);
      setControllers(controllersResponse.data || []);
    } catch (error) {
      console.error('Error loading data:', error);
      toast({ title: "Fel", description: "Kunde inte ladda data", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const loadTimerData = async () => {
    try {
      const { data } = await supabase
        .from('cached_external_timer')
        .select('recipe_name, beer_style')
        .order('last_synced_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        const recipeName = data.recipe_name;
        setTimerRecipeName(recipeName);
        setTimerBeerStyle(data.beer_style);

        if (recipeName) {
          const { data: existingBrew } = await supabase
            .from('brew_readings')
            .select('style, description, label_image_url')
            .eq('name', recipeName)
            .limit(1)
            .maybeSingle();

          if (existingBrew) {
            setTimerBrewMatch({
              style: existingBrew.style,
              description: existingBrew.description ?? undefined,
              label_image_url: existingBrew.label_image_url ?? undefined,
            });
          }
        }
      }
    } catch (error) {
      console.error('Error loading timer data:', error);
    }
  };

  const setPiPending = useCallback(async (brewId: string, pending: boolean) => {
    const { error } = await supabase
      .from('brew_readings')
      .update({ pi_pending_at: pending ? new Date().toISOString() : null })
      .eq('id', brewId);
    if (error) {
      toast({ title: "Fel", description: "Kunde inte uppdatera bryggden", variant: "destructive" });
      return;
    }
    setCustomBrews(prev => prev.map(b => b.id === brewId
      ? { ...b, pi_pending_at: pending ? new Date().toISOString() : null }
      : b));
    toast({
      title: pending ? "Skickad till Jäscontroller" : "Borttagen ur kön",
      description: pending ? "Bryggden dyker upp på Pi:n inom 30 sekunder" : undefined,
    });
  }, [toast]);

  const deleteCustomBrew = useCallback(async (brewId: string) => {
    try {
      const { error } = await supabase.from('brew_readings').delete().eq('id', brewId);
      if (error) throw error;
      toast({ title: "Borttagen", description: "Egen öl har tagits bort" });
      setCustomBrews(prev => prev.filter(b => b.id !== brewId));
    } catch (error) {
      console.error('Error deleting custom brew:', error);
      toast({ title: "Fel", description: "Kunde inte ta bort ölen", variant: "destructive" });
    }
  }, [toast]);

  const openCustomBrewDialog = useCallback((prefill?: CustomBrewPrefill | null) => {
    setPrefillData(prefill ?? null);
    setEditingBrew(null);
    setShowCustomBrewDialog(true);
  }, []);

  const openEditBrewDialog = useCallback((brew: CustomBrewData) => {
    setEditingBrew(brew);
    setShowCustomBrewDialog(true);
  }, []);

  const closeCustomBrewDialog = useCallback(() => {
    setShowCustomBrewDialog(false);
    setEditingBrew(null);
    setPrefillData(null);
  }, []);

  return {
    customBrews,
    pills,
    controllers,
    loading,
    showCustomBrewDialog,
    editingBrew,
    prefillData,
    timerRecipeName,
    timerBeerStyle,
    timerBrewMatch,
    deleteCustomBrew,
    setPiPending,
    openCustomBrewDialog,
    openEditBrewDialog,
    closeCustomBrewDialog,
    setShowCustomBrewDialog,
    loadData,
  };
}
