import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { AirVent, Thermometer, Check, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { sv } from "date-fns/locale";

interface ControllerData {
  id: string;
  controller_id: string;
  name: string;
  current_temp: number | null;
  target_temp: number | null;
  last_update: string | null;
  cooling_enabled: boolean;
  heating_enabled: boolean;
  heating_utilisation: number;
}

export function RaptControllersManagement() {
  const [controllers, setControllers] = useState<ControllerData[]>([]);
  const [selectedControllers, setSelectedControllers] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [editingControllerId, setEditingControllerId] = useState<string | null>(null);
  const [tempTargetTemp, setTempTargetTemp] = useState<string>("");
  const [updating, setUpdating] = useState(false);
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

  const handleStartEdit = (controller: ControllerData) => {
    setEditingControllerId(controller.controller_id);
    setTempTargetTemp(controller.target_temp?.toString() || "");
  };

  const handleCancelEdit = () => {
    setEditingControllerId(null);
    setTempTargetTemp("");
  };

  const handleUpdateTargetTemp = async (controllerId: string) => {
    const controller = controllers.find(c => c.controller_id === controllerId);
    if (!controller) return;

    const targetTemp = parseFloat(tempTargetTemp);
    
    if (isNaN(targetTemp)) {
      toast({
        title: "Ogiltigt värde",
        description: "Ange en giltig temperatur",
        variant: "destructive",
      });
      return;
    }

    setUpdating(true);
    try {
      const { data, error } = await supabase.functions.invoke('rapt-update-controller', {
        body: {
          controllerId: controller.controller_id,
          action: 'setTargetTemperature',
          value: targetTemp
        }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Update local state
      setControllers(prev => prev.map(c => 
        c.controller_id === controllerId 
          ? { ...c, target_temp: targetTemp }
          : c
      ));

      setEditingControllerId(null);
      setTempTargetTemp("");

      toast({
        title: "Måltemperatur uppdaterad",
        description: `${controller.name} måltemperatur är nu ${targetTemp}°C`,
      });
    } catch (error) {
      console.error('Error updating target temperature:', error);
      toast({
        title: "Fel",
        description: "Kunde inte uppdatera måltemperatur",
        variant: "destructive",
      });
    } finally {
      setUpdating(false);
    }
  };

  const handleToggleHeating = async (controller: ControllerData, enabled: boolean) => {
    try {
      const { data, error } = await supabase.functions.invoke('rapt-update-controller', {
        body: {
          controllerId: controller.controller_id,
          action: 'setHeatingEnabled',
          value: enabled
        }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setControllers(prev => prev.map(c => 
        c.controller_id === controller.controller_id 
          ? { ...c, heating_enabled: enabled }
          : c
      ));

      toast({
        title: "Värme uppdaterad",
        description: `Värme är nu ${enabled ? 'på' : 'av'} för ${controller.name}`,
      });
    } catch (error) {
      console.error('Error toggling heating:', error);
      toast({
        title: "Fel",
        description: "Kunde inte uppdatera värmeinställning",
        variant: "destructive",
      });
    }
  };

  const handleToggleCooling = async (controller: ControllerData, enabled: boolean) => {
    try {
      const { data, error } = await supabase.functions.invoke('rapt-update-controller', {
        body: {
          controllerId: controller.controller_id,
          action: 'setCoolingEnabled',
          value: enabled
        }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setControllers(prev => prev.map(c => 
        c.controller_id === controller.controller_id 
          ? { ...c, cooling_enabled: enabled }
          : c
      ));

      toast({
        title: "Kyla uppdaterad",
        description: `Kyla är nu ${enabled ? 'på' : 'av'} för ${controller.name}`,
      });
    } catch (error) {
      console.error('Error toggling cooling:', error);
      toast({
        title: "Fel",
        description: "Kunde inte uppdatera kylainställning",
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
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 flex-1">
                <AirVent size={24} className="text-primary" />
                <div className="flex-1">
                  <p className="font-medium">{controller.name}</p>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">
                      {controller.current_temp !== null || controller.target_temp !== null ? (
                        <>
                          {controller.current_temp !== null && `Aktuell: ${controller.current_temp.toFixed(1)}°C`}
                          {controller.current_temp !== null && controller.target_temp !== null && ' | '}
                          {controller.target_temp !== null && `Inställning: ${controller.target_temp.toFixed(1)}°C`}
                        </>
                      ) : (
                        'Ingen data'
                      )}
                    </p>
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={controller.heating_enabled}
                          onCheckedChange={(checked) => handleToggleHeating(controller, checked)}
                        />
                        <span className={`text-xs px-2 py-1 rounded-md font-medium transition-all ${
                          controller.heating_utilisation > 0 
                            ? 'bg-orange-500 text-white shadow-md' 
                            : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                        }`}>
                          🔥 Värme {controller.heating_utilisation > 0 ? 'på' : 'av'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={controller.cooling_enabled}
                          onCheckedChange={(checked) => handleToggleCooling(controller, checked)}
                        />
                        <span className={`text-xs px-2 py-1 rounded-md font-medium transition-all ${
                          controller.heating_utilisation === 0 && controller.current_temp > controller.target_temp
                            ? 'bg-blue-500 text-white shadow-md'
                            : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                        }`}>
                          ❄️ Kyla {controller.heating_utilisation === 0 && controller.current_temp > controller.target_temp ? 'på' : 'av'}
                        </span>
                      </div>
                    </div>
                    {controller.last_update && (
                      <p className="text-xs text-muted-foreground">
                        Senast synlig: {formatDistanceToNow(new Date(controller.last_update), { 
                          addSuffix: true, 
                          locale: sv 
                        })}
                      </p>
                    )}
                  </div>
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
            
            {editingControllerId === controller.controller_id ? (
              <div className="flex items-center gap-2 pl-9">
                <Input
                  type="number"
                  value={tempTargetTemp}
                  onChange={(e) => setTempTargetTemp(e.target.value)}
                  placeholder="°C"
                  className="w-20 h-8"
                  disabled={updating}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleUpdateTargetTemp(controller.controller_id)}
                  disabled={updating}
                >
                  <Check className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleCancelEdit}
                  disabled={updating}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="pl-9">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleStartEdit(controller)}
                  className="h-8 px-3"
                >
                  <Thermometer className="h-4 w-4 mr-1" />
                  Ändra måltemperatur
                </Button>
              </div>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
