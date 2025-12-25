import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AirVent, Thermometer, Check, X, ChevronUp, ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { sv } from "date-fns/locale";

interface ControllerData {
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
}

interface SelectedController {
  id: string;
  controller_id: string;
  is_visible: boolean;
  display_order: number;
}

export function RaptControllersManagement() {
  const [controllers, setControllers] = useState<ControllerData[]>([]);
  const [selectedControllers, setSelectedControllers] = useState<Record<string, boolean>>({});
  const [selectedControllersData, setSelectedControllersData] = useState<SelectedController[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingControllerId, setEditingControllerId] = useState<string | null>(null);
  const [tempTargetTemp, setTempTargetTemp] = useState<string>("");
  const [editingLimitsId, setEditingLimitsId] = useState<string | null>(null);
  const [tempMinTemp, setTempMinTemp] = useState<string>("");
  const [tempMaxTemp, setTempMaxTemp] = useState<string>("");
  const [updating, setUpdating] = useState(false);
  const [syncInterval, setSyncInterval] = useState<number>(300);
  const { toast } = useToast();

  useEffect(() => {
    loadData();

    // Subscribe to realtime updates for temperature controllers and settings
    const channel = supabase
      .channel('rapt_temp_controllers_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rapt_temp_controllers'
        },
        (payload) => {
          console.log('Temperature controller updated:', payload);
          loadData();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'selected_rapt_temp_controllers'
        },
        (payload) => {
          console.log('Selected controllers updated:', payload);
          loadData();
        }
      )
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
          if (newData?.rapt_sync_interval) {
            setSyncInterval(newData.rapt_sync_interval);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const loadData = async () => {
    try {
      // Load selected controllers with display_order first
      const { data: selectedData, error: selectedError } = await supabase
        .from('selected_rapt_temp_controllers')
        .select('*')
        .order('display_order');

      if (selectedError) throw selectedError;

      setSelectedControllersData(selectedData || []);
      
      // Get all controller IDs from selected controllers (to maintain order)
      const selectedControllerIds = selectedData?.map(s => s.controller_id) || [];

      if (selectedControllerIds.length === 0) {
        setControllers([]);
        setLoading(false);
        return;
      }

      // Load all controllers data
      const { data: controllersData, error: controllersError } = await supabase
        .from('rapt_temp_controllers')
        .select('*')
        .in('controller_id', selectedControllerIds);

      if (controllersError) throw controllersError;

      // Sort controllers by display_order
      const sortedControllers = (controllersData || []).sort((a, b) => {
        const aIndex = selectedControllerIds.indexOf(a.controller_id);
        const bIndex = selectedControllerIds.indexOf(b.controller_id);
        return aIndex - bIndex;
      });

      setControllers(sortedControllers);

      // Load sync settings to get the interval
      const { data: syncData, error: syncError } = await supabase
        .from('sync_settings')
        .select('rapt_sync_interval')
        .limit(1)
        .maybeSingle();

      if (syncError) {
        console.error('Error loading sync settings:', syncError);
      } else if (syncData) {
        setSyncInterval(syncData.rapt_sync_interval);
      }

      // Create a map of selected controllers
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
        // Get max display_order and add 1
        const maxOrder = Math.max(...selectedControllersData.map(c => c.display_order), 0);
        
        // Insert new
        const { error } = await supabase
          .from('selected_rapt_temp_controllers')
          .insert({ controller_id: controllerId, is_visible: visible, display_order: maxOrder + 1 });

        if (error) throw error;
      }

      setSelectedControllers(prev => ({ ...prev, [controllerId]: visible }));
      loadData(); // Reload to get updated data

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

  const handleMoveUp = async (controllerId: string) => {
    const currentIndex = selectedControllersData.findIndex(c => c.controller_id === controllerId);
    if (currentIndex <= 0) return;

    const current = selectedControllersData[currentIndex];
    const previous = selectedControllersData[currentIndex - 1];

    try {
      // Swap display_order
      await supabase
        .from('selected_rapt_temp_controllers')
        .update({ display_order: previous.display_order })
        .eq('controller_id', current.controller_id);

      await supabase
        .from('selected_rapt_temp_controllers')
        .update({ display_order: current.display_order })
        .eq('controller_id', previous.controller_id);

      loadData();
    } catch (error) {
      console.error('Error moving controller:', error);
      toast({
        title: "Fel",
        description: "Kunde inte flytta controller",
        variant: "destructive",
      });
    }
  };

  const handleMoveDown = async (controllerId: string) => {
    const currentIndex = selectedControllersData.findIndex(c => c.controller_id === controllerId);
    if (currentIndex < 0 || currentIndex >= selectedControllersData.length - 1) return;

    const current = selectedControllersData[currentIndex];
    const next = selectedControllersData[currentIndex + 1];

    try {
      // Swap display_order
      await supabase
        .from('selected_rapt_temp_controllers')
        .update({ display_order: next.display_order })
        .eq('controller_id', current.controller_id);

      await supabase
        .from('selected_rapt_temp_controllers')
        .update({ display_order: current.display_order })
        .eq('controller_id', next.controller_id);

      loadData();
    } catch (error) {
      console.error('Error moving controller:', error);
      toast({
        title: "Fel",
        description: "Kunde inte flytta controller",
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

  const handleStartEditLimits = (controller: ControllerData) => {
    setEditingLimitsId(controller.controller_id);
    setTempMinTemp(controller.min_target_temp?.toString() || "-5");
    setTempMaxTemp(controller.max_target_temp?.toString() || "25");
  };

  const handleCancelEditLimits = () => {
    setEditingLimitsId(null);
    setTempMinTemp("");
    setTempMaxTemp("");
  };

  const handleUpdateLimits = async (controllerId: string) => {
    const controller = controllers.find(c => c.controller_id === controllerId);
    if (!controller) return;

    const minTemp = parseFloat(tempMinTemp);
    const maxTemp = parseFloat(tempMaxTemp);
    
    if (isNaN(minTemp) || isNaN(maxTemp)) {
      toast({
        title: "Ogiltigt värde",
        description: "Ange giltiga temperaturer",
        variant: "destructive",
      });
      return;
    }

    if (minTemp >= maxTemp) {
      toast({
        title: "Ogiltigt intervall",
        description: "Min temperatur måste vara lägre än max temperatur",
        variant: "destructive",
      });
      return;
    }

    setUpdating(true);
    try {
      const { error } = await supabase
        .from('rapt_temp_controllers')
        .update({ 
          min_target_temp: minTemp,
          max_target_temp: maxTemp
        })
        .eq('controller_id', controllerId);

      if (error) throw error;

      // Update local state
      setControllers(prev => prev.map(c => 
        c.controller_id === controllerId 
          ? { ...c, min_target_temp: minTemp, max_target_temp: maxTemp }
          : c
      ));

      setEditingLimitsId(null);
      setTempMinTemp("");
      setTempMaxTemp("");

      toast({
        title: "Temperaturintervall uppdaterat",
        description: `${controller.name}: ${minTemp}°C till ${maxTemp}°C`,
      });
    } catch (error) {
      console.error('Error updating limits:', error);
      toast({
        title: "Fel",
        description: "Kunde inte uppdatera temperaturintervall",
        variant: "destructive",
      });
    } finally {
      setUpdating(false);
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

  const getSyncIntervalText = () => {
    const minutes = Math.floor(syncInterval / 60);
    if (minutes === 1) return "varje minut";
    if (minutes < 60) return `var ${minutes}:e minut`;
    const hours = Math.floor(minutes / 60);
    return `var ${hours}:e timme`;
  };

  return (
    <div className="space-y-3">
      <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-md">
        💡 <strong>Tips:</strong> Endast controllers som är markerade som "Visa" synkas automatiskt {getSyncIntervalText()}. Dolda controllers visas här men uppdateras inte.
      </div>
      {controllers.map((controller) => {
        const controllerIndex = selectedControllersData.findIndex(c => c.controller_id === controller.controller_id);
        const isFirst = controllerIndex === 0;
        const isLast = controllerIndex === selectedControllersData.length - 1;
        const isSelected = selectedControllers[controller.controller_id];
        
        return (
        <Card key={controller.id} className="p-4">
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <AirVent size={24} className="text-primary flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{controller.name}</p>
                  <div className="space-y-1">
                    {(() => {
                      const displayTemp = controller.pill_temp ?? controller.current_temp;
                      return displayTemp !== null ? (
                        <p className="text-sm text-muted-foreground">
                          Aktuell: {displayTemp.toFixed(1)}°C
                        </p>
                      ) : null;
                    })()}
                    {controller.target_temp !== null && (
                      <p className="text-sm text-muted-foreground">
                        Inställning: {controller.target_temp.toFixed(1)}°C
                      </p>
                    )}
                    {(() => {
                      const displayTemp = controller.pill_temp ?? controller.current_temp;
                      return displayTemp === null && controller.target_temp === null ? (
                        <p className="text-sm text-muted-foreground">Ingen data</p>
                      ) : null;
                    })()}
                    <div className="flex flex-wrap gap-2">
                      {controller.heating_enabled && (
                        <span className={`text-xs px-2 py-1 rounded-md font-medium transition-all ${
                          controller.heating_utilisation > 0 
                            ? 'bg-orange-500 text-white shadow-md' 
                            : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                        }`}>
                          🔥 Värme {controller.heating_utilisation > 0 ? 'på' : 'av'}
                        </span>
                      )}
                      {controller.cooling_enabled && (() => {
                        const displayTemp = controller.pill_temp ?? controller.current_temp;
                        const isActivelyCooling = controller.heating_utilisation === 0 && displayTemp > (controller.target_temp + 0.1);
                        return (
                          <span className={`text-xs px-2 py-1 rounded-md font-medium transition-all ${
                            isActivelyCooling
                              ? 'bg-blue-500 text-white shadow-md'
                              : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                          }`}>
                            ❄️ Kyla {isActivelyCooling ? 'på' : 'av'}
                          </span>
                        );
                      })()}
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
              
              <div className="flex items-center gap-3 flex-shrink-0">
                {isSelected && controllerIndex >= 0 && (
                  <div className="flex flex-col gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleMoveUp(controller.controller_id)}
                      disabled={isFirst}
                      className="h-6 w-6 p-0"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleMoveDown(controller.controller_id)}
                      disabled={isLast}
                      className="h-6 w-6 p-0"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </div>
                )}
                
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
                    className="text-sm cursor-pointer leading-none whitespace-nowrap"
                  >
                    Visa
                  </label>
                </div>
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
            ) : editingLimitsId === controller.controller_id ? (
              <div className="space-y-2 pl-9">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="flex items-center gap-2 flex-1">
                    <span className="text-sm text-muted-foreground w-12">Min:</span>
                    <Input
                      type="number"
                      value={tempMinTemp}
                      onChange={(e) => setTempMinTemp(e.target.value)}
                      placeholder="°C"
                      className="w-20 h-8"
                      disabled={updating}
                    />
                    <span className="text-sm text-muted-foreground w-12">Max:</span>
                    <Input
                      type="number"
                      value={tempMaxTemp}
                      onChange={(e) => setTempMaxTemp(e.target.value)}
                      placeholder="°C"
                      className="w-20 h-8"
                      disabled={updating}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleUpdateLimits(controller.controller_id)}
                      disabled={updating}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleCancelEditLimits}
                      disabled={updating}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2 pl-9">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleStartEdit(controller)}
                  className="h-8 px-3 w-fit"
                >
                  <Thermometer className="h-4 w-4 mr-1" />
                  Ändra måltemperatur
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleStartEditLimits(controller)}
                  className="h-8 px-3 w-fit"
                >
                  Min/Max ({controller.min_target_temp ?? -5}°C / {controller.max_target_temp ?? 25}°C)
                </Button>
              </div>
            )}
          </div>
        </Card>
        );
      })}
    </div>
  );
}
