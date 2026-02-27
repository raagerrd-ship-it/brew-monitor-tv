import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pill, ChevronUp, ChevronDown, Link2 } from "lucide-react";
import { useToast } from "@/hooks";
import { formatDistanceToNow } from "date-fns";
import { sv } from "date-fns/locale";

interface PillData {
  id: string;
  pill_id: string;
  name: string;
  color: string;
  battery_level: number;
  last_update: string | null;
}

interface SelectedPill {
  id: string;
  pill_id: string;
  is_visible: boolean;
  display_order: number;
}

export function RaptPillsManagement() {
  const [pills, setPills] = useState<PillData[]>([]);
  const [linkedPillIds, setLinkedPillIds] = useState<string[]>([]);
  const [selectedPills, setSelectedPills] = useState<Record<string, boolean>>({});
  const [selectedPillsData, setSelectedPillsData] = useState<SelectedPill[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const isLocalChange = useRef(false);

  useEffect(() => {
    loadData();

    // Subscribe to realtime updates
    const channel = supabase
      .channel('rapt_pills_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rapt_pills'
        },
        (payload) => {
          console.log('RAPT pill updated:', payload);
          if (!isLocalChange.current) {
            toast({
              title: "Uppdatering från annan enhet",
              description: "Pill-data har uppdaterats",
            });
          }
          isLocalChange.current = false;
          loadData();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'selected_rapt_pills'
        },
        (payload) => {
          console.log('Selected pills updated:', payload);
          if (!isLocalChange.current) {
            toast({
              title: "Uppdatering från annan enhet",
              description: "Pill-inställningar har ändrats",
            });
          }
          isLocalChange.current = false;
          loadData();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rapt_temp_controllers'
        },
        () => {
          // Reload when controllers change (pill linking)
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
      // Load selected pills with display_order first
      const { data: selectedData, error: selectedError } = await supabase
        .from('selected_rapt_pills')
        .select('*')
        .order('display_order');

      if (selectedError) throw selectedError;

      setSelectedPillsData(selectedData || []);
      
      // Get all pill IDs from selected pills (to maintain order)
      const selectedPillIds = selectedData?.map(s => s.pill_id) || [];

      if (selectedPillIds.length === 0) {
        setPills([]);
        setLoading(false);
        return;
      }

      // Load all pills data
      const { data: pillsData, error: pillsError } = await supabase
        .from('rapt_pills')
        .select('*')
        .in('pill_id', selectedPillIds);

      if (pillsError) throw pillsError;

      // Load linked pill IDs from controllers
      const { data: controllersData, error: controllersError } = await supabase
        .from('rapt_temp_controllers')
        .select('linked_pill_id')
        .not('linked_pill_id', 'is', null);

      if (controllersError) {
        console.error('Error loading controllers:', controllersError);
      } else {
        const linked = controllersData?.map(c => c.linked_pill_id).filter(Boolean) as string[];
        setLinkedPillIds(linked);
      }

      // Sort pills by display_order
      const sortedPills = (pillsData || []).sort((a, b) => {
        const aIndex = selectedPillIds.indexOf(a.pill_id);
        const bIndex = selectedPillIds.indexOf(b.pill_id);
        return aIndex - bIndex;
      });

      setPills(sortedPills);

      // Create a map of selected pills
      const selectedMap: Record<string, boolean> = {};
      sortedPills.forEach(pill => {
        const selected = selectedData?.find(s => s.pill_id === pill.pill_id);
        selectedMap[pill.pill_id] = selected?.is_visible ?? false;
      });
      setSelectedPills(selectedMap);
    } catch (error) {
      console.error('Error loading pills:', error);
      toast({
        title: "Fel",
        description: "Kunde inte ladda Pills",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleTogglePill = async (pillId: string, visible: boolean) => {
    try {
      isLocalChange.current = true;
      // Check if entry exists
      const { data: existing } = await supabase
        .from('selected_rapt_pills')
        .select('id')
        .eq('pill_id', pillId)
        .maybeSingle();

      if (existing) {
        // Update existing
        const { error } = await supabase
          .from('selected_rapt_pills')
          .update({ is_visible: visible })
          .eq('pill_id', pillId);

        if (error) throw error;
      } else {
        // Get max display_order and add 1
        const maxOrder = Math.max(...selectedPillsData.map(p => p.display_order), 0);
        
        // Insert new
        const { error } = await supabase
          .from('selected_rapt_pills')
          .insert({ pill_id: pillId, is_visible: visible, display_order: maxOrder + 1 });

        if (error) throw error;
      }

      setSelectedPills(prev => ({ ...prev, [pillId]: visible }));
      loadData(); // Reload to get updated data

      toast({
        title: "Inställning sparad",
        description: `${pills.find(p => p.pill_id === pillId)?.name} ${visible ? 'visas nu' : 'är dold'}`,
      });
    } catch (error) {
      console.error('Error updating pill visibility:', error);
      toast({
        title: "Fel",
        description: "Kunde inte spara inställning",
        variant: "destructive",
      });
    }
  };

  const handleMoveUp = async (pillId: string) => {
    const currentIndex = selectedPillsData.findIndex(p => p.pill_id === pillId);
    if (currentIndex <= 0) return;

    const current = selectedPillsData[currentIndex];
    const previous = selectedPillsData[currentIndex - 1];

    try {
      isLocalChange.current = true;
      // Swap display_order
      await supabase
        .from('selected_rapt_pills')
        .update({ display_order: previous.display_order })
        .eq('pill_id', current.pill_id);

      await supabase
        .from('selected_rapt_pills')
        .update({ display_order: current.display_order })
        .eq('pill_id', previous.pill_id);

      loadData();
    } catch (error) {
      console.error('Error moving pill:', error);
      toast({
        title: "Fel",
        description: "Kunde inte flytta pill",
        variant: "destructive",
      });
    }
  };

  const handleMoveDown = async (pillId: string) => {
    const currentIndex = selectedPillsData.findIndex(p => p.pill_id === pillId);
    if (currentIndex < 0 || currentIndex >= selectedPillsData.length - 1) return;

    const current = selectedPillsData[currentIndex];
    const next = selectedPillsData[currentIndex + 1];

    try {
      isLocalChange.current = true;
      // Swap display_order
      await supabase
        .from('selected_rapt_pills')
        .update({ display_order: next.display_order })
        .eq('pill_id', current.pill_id);

      await supabase
        .from('selected_rapt_pills')
        .update({ display_order: current.display_order })
        .eq('pill_id', next.pill_id);

      loadData();
    } catch (error) {
      console.error('Error moving pill:', error);
      toast({
        title: "Fel",
        description: "Kunde inte flytta pill",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground">Laddar Pills...</div>;
  }

  // Filter out pills that are linked to controllers
  const unlinkedPills = pills.filter(pill => !linkedPillIds.includes(pill.pill_id));

  if (pills.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        Inga Pills hittades. Kör RAPT synkronisering för att hämta dina Pills.
      </div>
    );
  }

  if (unlinkedPills.length === 0) {
    return (
      <div className="text-sm text-muted-foreground bg-muted/30 p-4 rounded-lg flex items-center gap-3">
        <Link2 className="h-5 w-5 text-primary" />
        <div>
          <p className="font-medium text-foreground">Alla pills är kopplade</p>
          <p className="text-muted-foreground">Alla dina pills är kopplade till Temperature Controllers ovan.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-sm text-muted-foreground bg-muted/30 p-3 rounded-lg">
        💡 Pills som inte är kopplade till någon Temperature Controller visas här.
      </div>
      {unlinkedPills.map((pill) => {
        const pillIndex = selectedPillsData.findIndex(p => p.pill_id === pill.pill_id);
        const isFirst = pillIndex === 0;
        const isLast = pillIndex === selectedPillsData.length - 1;
        const isSelected = selectedPills[pill.pill_id];
        
        return (
        <Card key={pill.id} className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <Pill color={pill.color} size={24} strokeWidth={2.5} className="flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{pill.name}</p>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">
                    Batteri: {pill.battery_level}%
                  </p>
                  {pill.last_update && (
                    <p className="text-xs text-muted-foreground">
                      Senast synlig: {formatDistanceToNow(new Date(pill.last_update), { 
                        addSuffix: true, 
                        locale: sv 
                      })}
                    </p>
                  )}
                </div>
              </div>
            </div>
            
            {isSelected && pillIndex >= 0 && (
              <div className="flex flex-col gap-1 flex-shrink-0">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleMoveUp(pill.pill_id)}
                  disabled={isFirst}
                  className="h-6 w-6 p-0"
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleMoveDown(pill.pill_id)}
                  disabled={isLast}
                  className="h-6 w-6 p-0"
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </div>
            )}
            
            <div className="flex items-center space-x-2 flex-shrink-0">
              <Checkbox
                id={`pill-${pill.pill_id}`}
                checked={selectedPills[pill.pill_id] || false}
                onCheckedChange={(checked) => 
                  handleTogglePill(pill.pill_id, !!checked)
                }
              />
              <label
                htmlFor={`pill-${pill.pill_id}`}
                className="text-sm cursor-pointer leading-none whitespace-nowrap"
              >
                Visa
              </label>
            </div>
          </div>
        </Card>
        );
      })}
    </div>
  );
}
