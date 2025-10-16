import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { AirVent } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ControllerData {
  id: string;
  controller_id: string;
  name: string;
  current_temp: number | null;
  target_temp: number | null;
}

export function RaptControllersManagement() {
  const [controllers, setControllers] = useState<ControllerData[]>([]);
  const [selectedControllers, setSelectedControllers] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      // Load all controllers
      const { data: controllersData, error: controllersError } = await supabase
        .from('rapt_temp_controllers')
        .select('*')
        .order('name');

      if (controllersError) throw controllersError;

      // Load selected controllers
      const { data: selectedData, error: selectedError } = await supabase
        .from('selected_rapt_temp_controllers')
        .select('*');

      if (selectedError) throw selectedError;

      setControllers(controllersData || []);

      // Create a map of selected controllers
      const selectedMap: Record<string, boolean> = {};
      controllersData?.forEach(controller => {
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
  };

  const handleToggleController = async (controllerId: string, visible: boolean) => {
    try {
      // Check if entry exists
      const { data: existing } = await supabase
        .from('selected_rapt_temp_controllers')
        .select('id')
        .eq('controller_id', controllerId)
        .maybeSingle();

      if (existing) {
        // Update existing
        const { error } = await supabase
          .from('selected_rapt_temp_controllers')
          .update({ is_visible: visible })
          .eq('controller_id', controllerId);

        if (error) throw error;
      } else {
        // Insert new
        const { error } = await supabase
          .from('selected_rapt_temp_controllers')
          .insert({ controller_id: controllerId, is_visible: visible });

        if (error) throw error;
      }

      setSelectedControllers(prev => ({ ...prev, [controllerId]: visible }));

      toast({
        title: "Inställning sparad",
        description: `${controllers.find(c => c.controller_id === controllerId)?.name} ${visible ? 'visas nu' : 'är dold'}`,
      });
    } catch (error) {
      console.error('Error updating controller visibility:', error);
      toast({
        title: "Fel",
        description: "Kunde inte spara inställning",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground">Laddar Temperature Controllers...</div>;
  }

  if (controllers.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        Inga Temperature Controllers hittades. Kör RAPT synkronisering för att hämta dina controllers.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {controllers.map((controller) => (
        <Card key={controller.id} className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AirVent size={24} className="text-primary" />
              <div>
                <p className="font-medium">{controller.name}</p>
                <p className="text-sm text-muted-foreground">
                  {controller.current_temp !== null
                    ? `${controller.current_temp.toFixed(1)}°C`
                    : 'Ingen data'}
                  {controller.target_temp !== null &&
                    ` → ${controller.target_temp.toFixed(1)}°C`}
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id={`controller-${controller.controller_id}`}
                checked={selectedControllers[controller.controller_id] || false}
                onCheckedChange={(checked) =>
                  handleToggleController(controller.controller_id, !!checked)
                }
              />
              <label
                htmlFor={`controller-${controller.controller_id}`}
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
