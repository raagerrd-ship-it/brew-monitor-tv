import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import type { PillData, TempController } from '@/types/brew';
import type { CustomBrewData, CustomBrewPrefill } from '@/components/CustomBrewDialog';

interface BrewfatherBatch {
  _id: string;
  name: string;
  batchNo: number;
  brewDate?: string;
  recipe?: {
    name: string;
    style?: { name: string };
  };
  status: string;
}

interface SelectedBrew {
  batch_id: string;
  display_order: number;
  is_visible: boolean;
}

export function useBrewManagement() {
  const navigate = useNavigate();
  const [batches, setBatches] = useState<BrewfatherBatch[]>([]);
  const [customBrews, setCustomBrews] = useState<CustomBrewData[]>([]);
  const [selectedBrews, setSelectedBrews] = useState<SelectedBrew[]>([]);
  const [pills, setPills] = useState<PillData[]>([]);
  const [controllers, setControllers] = useState<TempController[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
  const isLocalChange = useRef(false);

  useEffect(() => {
    loadData();
    loadTimerData();

    const channel = supabase
      .channel('selected_brews_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'selected_brews' },
        (payload) => {
          console.log('Selected brews updated:', payload);
          if (!isLocalChange.current) {
            toast({ title: "Uppdatering från annan enhet", description: "Öl-valet har ändrats" });
          }
          isLocalChange.current = false;
          loadData();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [toast]);

  const loadData = async () => {
    try {
      setLoading(true);

      const [batchesResponse, selectedResponse, customBrewsResponse, pillsResponse, controllersResponse] = await Promise.all([
        supabase.functions.invoke('brewfather-batches', { body: { limit: 10 } }),
        supabase.from('selected_brews').select('batch_id').eq('is_visible', true),
        supabase.from('brew_readings')
          .select('id, batch_id, name, style, batch_number, original_gravity, final_gravity, linked_controller_id, linked_pill_id, status, fermentation_start, label_image_url, description')
          .like('batch_id', 'custom_%'),
        supabase.from('rapt_pills').select('id, pill_id, name, color, battery_level, last_update'),
        supabase.from('rapt_temp_controllers')
          .select('id, controller_id, name, current_temp, pill_temp, target_temp, last_update, min_target_temp, max_target_temp, cooling_enabled, heating_enabled, heating_utilisation, linked_pill_id, cooling_hysteresis, heating_hysteresis, cooling_run_time, cooling_starts, heating_run_time, heating_starts')
      ]);

      if (batchesResponse.error) throw batchesResponse.error;
      if (selectedResponse.error) throw selectedResponse.error;

      setBatches(batchesResponse.data || []);
      setCustomBrews(customBrewsResponse.data || []);
      setPills(pillsResponse.data || []);
      setControllers(controllersResponse.data || []);

      setSelectedBrews((selectedResponse.data || []).map((b, index) => ({
        batch_id: b.batch_id,
        display_order: index + 1,
        is_visible: true
      })));
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

  const selectedBatchIds = useMemo(() =>
    new Set(selectedBrews.map(brew => brew.batch_id)),
    [selectedBrews]
  );

  const isSelected = useCallback((batchId: string) => {
    return selectedBatchIds.has(batchId);
  }, [selectedBatchIds]);

  const toggleBrew = useCallback((batchId: string) => {
    if (isSelected(batchId)) {
      setSelectedBrews(prev => prev.filter(brew => brew.batch_id !== batchId));
    } else {
      if (selectedBrews.length >= 3) {
        toast({ title: "Maximum 3 öl", description: "Du kan bara visa upp till 3 öl samtidigt", variant: "destructive" });
        return;
      }
      setSelectedBrews(prev => [
        ...prev,
        { batch_id: batchId, display_order: prev.length + 1, is_visible: true },
      ]);
    }
  }, [selectedBrews.length, isSelected, toast]);

  const deleteCustomBrew = useCallback(async (brewId: string, batchId: string) => {
    try {
      await supabase.from('selected_brews').delete().eq('batch_id', batchId);
      const { error } = await supabase.from('brew_readings').delete().eq('id', brewId);
      if (error) throw error;
      toast({ title: "Borttagen", description: "Egen öl har tagits bort" });
      setCustomBrews(prev => prev.filter(b => b.id !== brewId));
      setSelectedBrews(prev => prev.filter(b => b.batch_id !== batchId));
    } catch (error) {
      console.error('Error deleting custom brew:', error);
      toast({ title: "Fel", description: "Kunde inte ta bort ölen", variant: "destructive" });
    }
  }, [toast]);

  const saveSelection = useCallback(async () => {
    try {
      isLocalChange.current = true;
      setSaving(true);

      const { error: deleteError } = await supabase
        .from('selected_brews')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');
      if (deleteError) throw deleteError;

      if (selectedBrews.length > 0) {
        const { error: insertError } = await supabase
          .from('selected_brews')
          .insert(selectedBrews.map((brew, index) => ({
            batch_id: brew.batch_id,
            display_order: index + 1,
            is_visible: true,
          })));
        if (insertError) throw insertError;
      }

      const { error: syncError } = await supabase.functions.invoke('full-sync-brew-data', { body: {} });
      if (syncError) {
        console.error('Error during full sync:', syncError);
        toast({ title: "Varning", description: "Val sparade men synkroniseringen misslyckades", variant: "destructive" });
      } else {
        toast({ title: "Sparat!", description: "Dina val har sparats och synkroniserats" });
      }

      setTimeout(() => navigate("/"), 1000);
    } catch (error) {
      console.error('Error saving selection:', error);
      toast({ title: "Fel", description: "Kunde inte spara dina val", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }, [selectedBrews, navigate, toast]);

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
    batches,
    customBrews,
    selectedBrews,
    pills,
    controllers,
    loading,
    saving,
    showCustomBrewDialog,
    editingBrew,
    prefillData,
    timerRecipeName,
    timerBeerStyle,
    timerBrewMatch,
    isSelected,
    toggleBrew,
    deleteCustomBrew,
    saveSelection,
    openCustomBrewDialog,
    openEditBrewDialog,
    closeCustomBrewDialog,
    setShowCustomBrewDialog,
    loadData,
  };
}
