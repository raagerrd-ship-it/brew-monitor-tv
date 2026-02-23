import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Plus, Trash2, Pencil, Beer, Flame, Thermometer, GlassWater, Archive, FlaskConical } from "lucide-react";
import { Badge } from "./ui/badge";
import { CustomBrewDialog, type CustomBrewData, type CustomBrewPrefill } from "./CustomBrewDialog";
import type { PillData, TempController } from "@/types/brew";
interface BrewfatherBatch {
  _id: string;
  name: string;
  batchNo: number;
  brewDate?: string;
  recipe?: {
    name: string;
    style?: {
      name: string;
    };
  };
  status: string;
}

interface SelectedBrew {
  batch_id: string;
  display_order: number;
  is_visible: boolean;
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'Bryggning':
      return <Badge variant="outline" className="text-orange-400 border-orange-400/30 text-xs"><Flame className="h-3 w-3 mr-1" />Bryggning</Badge>;
    case 'Jäsning':
    case 'Fermenting':
      return <Badge variant="outline" className="text-green-400 border-green-400/30 text-xs"><FlaskConical className="h-3 w-3 mr-1" />Jäsning</Badge>;
    case 'Konditionering':
      return <Badge variant="outline" className="text-blue-400 border-blue-400/30 text-xs"><GlassWater className="h-3 w-3 mr-1" />Konditionering</Badge>;
    case 'Klar':
    case 'Completed':
      return <Badge variant="outline" className="text-muted-foreground border-muted text-xs">Klar</Badge>;
    default:
      return <Badge variant="outline" className="text-muted-foreground border-muted text-xs">{status}</Badge>;
  }
}

export function BrewManagement() {
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
  const { toast } = useToast();
  const isLocalChange = useRef(false);

  useEffect(() => {
    loadData();
    loadTimerData();

    // Subscribe to realtime updates for selected brews
    const channel = supabase
      .channel('selected_brews_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'selected_brews'
        },
        (payload) => {
          console.log('Selected brews updated:', payload);
          if (!isLocalChange.current) {
            toast({
              title: "Uppdatering från annan enhet",
              description: "Öl-valet har ändrats",
            });
          }
          isLocalChange.current = false;
          loadData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [toast]);

  const loadData = async () => {
    try {
      setLoading(true);

      // Fetch batches, selected brews, custom brews, pills, and controllers in parallel
      const [batchesResponse, selectedResponse, customBrewsResponse, pillsResponse, controllersResponse] = await Promise.all([
        supabase.functions.invoke('brewfather-batches', { body: { limit: 10 } }),
        supabase.from('selected_brews')
          .select('batch_id')
          .eq('is_visible', true),
        supabase.from('brew_readings')
          .select('id, batch_id, name, style, batch_number, original_gravity, final_gravity, linked_controller_id, linked_pill_id, status, fermentation_start, label_image_url, description')
          .like('batch_id', 'custom_%'),
        supabase.from('rapt_pills')
          .select('id, pill_id, name, color, battery_level, last_update'),
        supabase.from('rapt_temp_controllers')
          .select('id, controller_id, name, current_temp, pill_temp, target_temp, last_update, min_target_temp, max_target_temp, cooling_enabled, heating_enabled, heating_utilisation, linked_pill_id, cooling_hysteresis, heating_hysteresis, cooling_run_time, cooling_starts, heating_run_time, heating_starts')
      ]);

      if (batchesResponse.error) throw batchesResponse.error;
      if (selectedResponse.error) throw selectedResponse.error;
      
      // API returns batches already sorted by batchNo descending
      setBatches(batchesResponse.data || []);
      setCustomBrews(customBrewsResponse.data || []);
      setPills(pillsResponse.data || []);
      setControllers(controllersResponse.data || []);
      
      // Convert selected brews to internal format
      setSelectedBrews((selectedResponse.data || []).map((b, index) => ({
        batch_id: b.batch_id,
        display_order: index + 1,
        is_visible: true
      })));

    } catch (error) {
      console.error('Error loading data:', error);
      toast({
        title: "Fel",
        description: "Kunde inte ladda data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const [timerBrewMatch, setTimerBrewMatch] = useState<{
    style?: string;
    description?: string;
    label_image_url?: string;
  } | null>(null);

  const loadTimerData = async () => {
    try {
      const { data } = await supabase
        .from('cached_external_timer')
        .select('recipe_name, beer_style')
        .order('last_synced_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (data) {
        const recipeName = (data as Record<string, unknown>).recipe_name as string | null;
        setTimerRecipeName(recipeName);
        setTimerBeerStyle((data as Record<string, unknown>).beer_style as string | null);

        // Look up existing brew with same name for better prefill data
        if (recipeName) {
          const { data: existingBrew } = await supabase
            .from('brew_readings')
            .select('style, description, label_image_url')
            .eq('name', recipeName)
            .limit(1)
            .maybeSingle();
          
          if (existingBrew) {
            setTimerBrewMatch({
              style: (existingBrew as Record<string, unknown>).style as string | undefined,
              description: (existingBrew as Record<string, unknown>).description as string | undefined,
              label_image_url: (existingBrew as Record<string, unknown>).label_image_url as string | undefined,
            });
          }
        }
      }
    } catch (error) {
      console.error('Error loading timer data:', error);
    }
  };

  // Memoize selected batch IDs for faster lookups
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
        toast({
          title: "Maximum 3 öl",
          description: "Du kan bara visa upp till 3 öl samtidigt",
          variant: "destructive",
        });
        return;
      }
      setSelectedBrews(prev => [
        ...prev,
        {
          batch_id: batchId,
          display_order: prev.length + 1,
          is_visible: true,
        },
      ]);
    }
  }, [selectedBrews.length, isSelected, toast]);

  const deleteCustomBrew = async (brewId: string, batchId: string) => {
    try {
      // Delete from selected_brews first
      await supabase
        .from('selected_brews')
        .delete()
        .eq('batch_id', batchId);

      // Delete from brew_readings
      const { error } = await supabase
        .from('brew_readings')
        .delete()
        .eq('id', brewId);

      if (error) throw error;

      toast({
        title: "Borttagen",
        description: "Egen öl har tagits bort",
      });

      // Remove from local state
      setCustomBrews(prev => prev.filter(b => b.id !== brewId));
      setSelectedBrews(prev => prev.filter(b => b.batch_id !== batchId));
    } catch (error) {
      console.error('Error deleting custom brew:', error);
      toast({
        title: "Fel",
        description: "Kunde inte ta bort ölen",
        variant: "destructive",
      });
    }
  };

  const saveSelection = async () => {
    try {
      isLocalChange.current = true;
      setSaving(true);

      // Delete all existing selections
      const { error: deleteError } = await supabase
        .from('selected_brews')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');

      if (deleteError) throw deleteError;

      // Insert new selections
      if (selectedBrews.length > 0) {
        const { error: insertError } = await supabase
          .from('selected_brews')
          .insert(
            selectedBrews.map((brew, index) => ({
              batch_id: brew.batch_id,
              display_order: index + 1,
              is_visible: true,
            }))
          );

        if (insertError) throw insertError;
      }

      // Trigger full sync of selected brews
      const { error: syncError } = await supabase.functions.invoke('full-sync-brew-data', {
        body: {}
      });

      if (syncError) {
        console.error('Error during full sync:', syncError);
        toast({
          title: "Varning",
          description: "Val sparade men synkroniseringen misslyckades",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Sparat!",
          description: "Dina val har sparats och synkroniserats",
        });
      }

      // Navigate back to dashboard
      setTimeout(() => navigate("/"), 1000);

    } catch (error) {
      console.error('Error saving selection:', error);
      toast({
        title: "Fel",
        description: "Kunde inte spara dina val",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };


  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="space-y-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold">Hantera Öl</h2>
          <p className="text-sm text-muted-foreground">
            Välj upp till 3 öl att visa på dashboarden
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {timerRecipeName && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setPrefillData({
                  name: timerRecipeName || '',
                  style: timerBrewMatch?.style || timerBeerStyle || '',
                  description: timerBrewMatch?.description || undefined,
                  label_image_url: timerBrewMatch?.label_image_url || undefined,
                });
                setShowCustomBrewDialog(true);
              }}
            >
              <Beer className="mr-1.5 h-3.5 w-3.5" />
              <span className="truncate max-w-[180px]">Lägg till {timerRecipeName}</span>
            </Button>
          )}
          <Button size="sm" onClick={() => {
            setPrefillData(null);
            setShowCustomBrewDialog(true);
          }}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Skapa egen öl
          </Button>
        </div>
      </div>

      {/* Custom brews section */}
      {customBrews.filter(b => b.status !== 'Arkiverad').length > 0 && (
        <div className="space-y-2">
          <h3 className="text-lg font-semibold text-muted-foreground">Egna bryggningar</h3>
          <div className="grid gap-4">
            {customBrews
              .filter(b => b.status !== 'Arkiverad')
              .sort((a, b) => {
                const order: Record<string, number> = { 'Planering': 0, 'Bryggning': 1, 'Jäsning': 2, 'Fermenting': 2, 'Konditionering': 3, 'Klar': 4, 'Completed': 4 };
                return (order[a.status] ?? 5) - (order[b.status] ?? 5);
              })
              .map((brew) => (
              <Card key={brew.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <Checkbox
                      checked={isSelected(brew.batch_id)}
                      onCheckedChange={() => toggleBrew(brew.batch_id)}
                    />
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{brew.name}</h3>
                        <StatusBadge status={brew.status} />
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {brew.style || 'Custom'}
                        {brew.original_gravity ? ` · OG ${brew.original_gravity.toFixed(3)}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setEditingBrew(brew);
                        setShowCustomBrewDialog(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteCustomBrew(brew.id, brew.batch_id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Brewfather batches section */}
      <div className="space-y-2">
        <h3 className="text-lg font-semibold text-muted-foreground">Brewfather (10 senaste)</h3>
        <div className="grid gap-4">
          {batches.map((batch) => (
            <Card key={batch._id} className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <Checkbox
                    checked={isSelected(batch._id)}
                    onCheckedChange={() => toggleBrew(batch._id)}
                  />
                  <div>
                    <h3 className="font-semibold">
                      {batch.recipe?.name || batch.name}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Batch #{batch.batchNo} - {batch.status}
                    </p>
                    {batch.recipe?.style?.name && (
                      <p className="text-xs text-muted-foreground">
                        {batch.recipe.style.name}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-4 pt-4 border-t">
        <div className="flex justify-between items-center">
          <p className="text-sm text-muted-foreground">
            {selectedBrews.length} av 3 öl valda
          </p>
          <Button
            onClick={saveSelection}
            disabled={saving || selectedBrews.length === 0}
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sparar och synkroniserar...
              </>
            ) : (
              'Spara Val'
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          När du sparar ditt val görs en full synkronisering av de valda ölen
        </p>
      </div>

      <CustomBrewDialog
        open={showCustomBrewDialog}
        onOpenChange={(open) => {
          setShowCustomBrewDialog(open);
          if (!open) {
            setEditingBrew(null);
            setPrefillData(null);
          }
        }}
        pills={pills}
        controllers={controllers}
        onBrewSaved={loadData}
        editBrew={editingBrew}
        prefill={prefillData}
      />
    </div>
  );
}
