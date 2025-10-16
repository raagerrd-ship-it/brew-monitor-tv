import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Pill } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface PillData {
  id: string;
  pill_id: string;
  name: string;
  color: string;
  battery_level: number;
}

interface SelectedPill {
  pill_id: string;
  is_visible: boolean;
}

export function RaptPillsManagement() {
  const [pills, setPills] = useState<PillData[]>([]);
  const [selectedPills, setSelectedPills] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      // Load all pills
      const { data: pillsData, error: pillsError } = await supabase
        .from('rapt_pills')
        .select('*')
        .order('name');

      if (pillsError) throw pillsError;

      // Load selected pills
      const { data: selectedData, error: selectedError } = await supabase
        .from('selected_rapt_pills')
        .select('*');

      if (selectedError) throw selectedError;

      setPills(pillsData || []);

      // Create a map of selected pills
      const selectedMap: Record<string, boolean> = {};
      pillsData?.forEach(pill => {
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
        // Insert new
        const { error } = await supabase
          .from('selected_rapt_pills')
          .insert({ pill_id: pillId, is_visible: visible });

        if (error) throw error;
      }

      setSelectedPills(prev => ({ ...prev, [pillId]: visible }));

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

  if (loading) {
    return <div className="text-sm text-muted-foreground">Laddar Pills...</div>;
  }

  if (pills.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        Inga Pills hittades. Kör RAPT synkronisering för att hämta dina Pills.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {pills.map((pill) => (
        <Card key={pill.id} className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Pill color={pill.color} size={24} strokeWidth={2.5} />
              <div>
                <p className="font-medium">{pill.name}</p>
                <p className="text-sm text-muted-foreground">
                  Batteri: {pill.battery_level}%
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id={`pill-${pill.pill_id}`}
                checked={selectedPills[pill.pill_id] || false}
                onCheckedChange={(checked) => 
                  handleTogglePill(pill.pill_id, !!checked)
                }
              />
              <label
                htmlFor={`pill-${pill.pill_id}`}
                className="text-sm cursor-pointer leading-none"
              >
                Visa
              </label>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
