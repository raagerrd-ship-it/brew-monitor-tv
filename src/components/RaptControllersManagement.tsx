import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AirVent, Check, X, ChevronUp, ChevronDown, Snowflake, Thermometer, Flame, Clock, Settings2, Pill, Link2, Unlink } from "lucide-react";
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
  linked_pill_id: string | null;
  cooling_hysteresis: number | null;
  heating_hysteresis: number | null;
}

interface SelectedController {
  id: string;
  controller_id: string;
  is_visible: boolean;
  display_order: number;
}

interface PillData {
  pill_id: string;
  name: string;
  color: string;
  last_update: string | null;
}

export function RaptControllersManagement() {
  const [controllers, setControllers] = useState<ControllerData[]>([]);
  const [pills, setPills] = useState<PillData[]>([]);
  const [selectedControllers, setSelectedControllers] = useState<Record<string, boolean>>({});
  const [selectedControllersData, setSelectedControllersData] = useState<SelectedController[]>([]);
  const [coolerControllerId, setCoolerControllerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingLimitsId, setEditingLimitsId] = useState<string | null>(null);
  const [tempMinTemp, setTempMinTemp] = useState<string>("");
  const [tempMaxTemp, setTempMaxTemp] = useState<string>("");
  const [updating, setUpdating] = useState(false);
  const [syncInterval, setSyncInterval] = useState<number>(300);
  const { toast } = useToast();
  const isLocalChange = useRef(false);

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
          if (!isLocalChange.current) {
            toast({
              title: "Uppdatering från annan enhet",
              description: "Controller-data har uppdaterats",
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
          table: 'selected_rapt_temp_controllers'
        },
        (payload) => {
          console.log('Selected controllers updated:', payload);
          if (!isLocalChange.current) {
            toast({
              title: "Uppdatering från annan enhet",
              description: "Controller-inställningar har ändrats",
            });
          }
          isLocalChange.current = false;
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
            if (!isLocalChange.current) {
              toast({
                title: "Uppdatering från annan enhet",
                description: "Synkroniseringsinställningar har ändrats",
              });
            }
            isLocalChange.current = false;
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [toast]);

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

      // Load all pills for linking
      const { data: pillsData, error: pillsError } = await supabase
        .from('rapt_pills')
        .select('pill_id, name, color, last_update');

      if (pillsError) {
        console.error('Error loading pills:', pillsError);
      } else {
        setPills(pillsData || []);
      }

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

      // Load auto cooling settings to identify cooler controller
      const { data: coolingData, error: coolingError } = await supabase
        .from('auto_cooling_settings')
        .select('cooler_controller_id')
        .limit(1)
        .maybeSingle();

      if (coolingError) {
        console.error('Error loading cooling settings:', coolingError);
      } else if (coolingData?.cooler_controller_id) {
        setCoolerControllerId(coolingData.cooler_controller_id);
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
      isLocalChange.current = true;
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
      isLocalChange.current = true;
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
      isLocalChange.current = true;
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

  const handleLinkPill = async (controllerId: string, pillId: string | null) => {
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

      // Update local state
      setControllers(prev => prev.map(c => 
        c.controller_id === controllerId 
          ? { ...c, linked_pill_id: pillId }
          : c
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
      toast({
        title: "Fel",
        description: "Kunde inte uppdatera pill-koppling",
        variant: "destructive",
      });
    } finally {
      setUpdating(false);
    }
  };

  // Get pills that are already linked to other controllers
  const getLinkedPillIds = (excludeControllerId: string): string[] => {
    return controllers
      .filter(c => c.controller_id !== excludeControllerId && c.linked_pill_id)
      .map(c => c.linked_pill_id as string);
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
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Clock className="h-3 w-3" />
        Synkroniseras {getSyncIntervalText()}
      </p>
      
      <div className="grid gap-4">
        {controllers.map((controller) => {
          const controllerIndex = selectedControllersData.findIndex(c => c.controller_id === controller.controller_id);
          const isFirst = controllerIndex === 0;
          const isLast = controllerIndex === selectedControllersData.length - 1;
          const isSelected = selectedControllers[controller.controller_id];
          const isCooler = coolerControllerId === controller.controller_id;
          const displayTemp = controller.pill_temp ?? controller.current_temp;
          const isActivelyCooling = controller.cooling_enabled && displayTemp !== null && controller.target_temp !== null && displayTemp > (controller.target_temp + (controller.cooling_hysteresis ?? 0.2));
          const isActivelyHeating = controller.heating_enabled && displayTemp !== null && controller.target_temp !== null && displayTemp < (controller.target_temp - (controller.heating_hysteresis ?? 0.2));
          
          return (
            <Card 
              key={controller.id} 
              className={`overflow-hidden transition-all ${
                isCooler 
                  ? 'border-blue-500/50 bg-gradient-to-br from-blue-500/5 to-transparent' 
                  : 'hover:border-primary/30'
              } ${!isSelected ? 'opacity-60' : ''}`}
            >
              {/* Header with name and badges */}
              <div className={`px-4 py-3 border-b border-border/50 ${isCooler ? 'bg-blue-500/10' : 'bg-muted/30'}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`p-2 rounded-lg ${isCooler ? 'bg-blue-500/20 text-blue-500' : 'bg-primary/10 text-primary'}`}>
                      {isCooler ? <Snowflake className="h-5 w-5" /> : <Thermometer className="h-5 w-5" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-semibold break-words">{controller.name}</h4>
                        {isCooler && (
                          <Badge variant="secondary" className="bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/30 text-xs">
                            <Snowflake className="h-3 w-3 mr-1" />
                            Glykolkylare
                          </Badge>
                        )}
                      </div>
                      {controller.last_update && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Uppdaterad {formatDistanceToNow(new Date(controller.last_update), { 
                            addSuffix: true, 
                            locale: sv 
                          })}
                        </p>
                      )}
                    </div>
                  </div>
                  
                  {/* Visibility toggle and reorder */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="flex items-center space-x-2 bg-background/50 px-2 py-1 rounded-md border border-border/50">
                      <Checkbox
                        id={`controller-${controller.controller_id}`}
                        checked={selectedControllers[controller.controller_id] || false}
                        onCheckedChange={(checked) =>
                          handleToggleController(controller.controller_id, !!checked)
                        }
                      />
                      <label
                        htmlFor={`controller-${controller.controller_id}`}
                        className="text-xs cursor-pointer leading-none whitespace-nowrap font-medium"
                      >
                        Synlig
                      </label>
                    </div>
                    
                    {isSelected && controllerIndex >= 0 && (
                      <div className="flex items-center gap-0.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleMoveUp(controller.controller_id)}
                          disabled={isFirst}
                          className="h-7 w-7 p-0"
                          title="Flytta upp"
                        >
                          <ChevronUp className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleMoveDown(controller.controller_id)}
                          disabled={isLast}
                          className="h-7 w-7 p-0"
                          title="Flytta ner"
                        >
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              
              {/* Temperature data */}
              <div className="px-4 py-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {/* Current temp */}
                  <div className="bg-muted/30 rounded-lg p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Aktuell</p>
                    <p className="text-xl font-bold tabular-nums">
                      {displayTemp !== null ? `${displayTemp.toFixed(1)}°` : '—'}
                    </p>
                  </div>
                  
                  {/* Target temp */}
                  <div className="bg-muted/30 rounded-lg p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Mål</p>
                    <p className="text-xl font-bold tabular-nums text-primary">
                      {controller.target_temp !== null ? `${controller.target_temp.toFixed(1)}°` : '—'}
                    </p>
                  </div>
                  
                  {/* Heating status */}
                  <div className={`rounded-lg p-3 text-center transition-all ${
                    isActivelyHeating 
                      ? 'bg-orange-500/20 border border-orange-500/30' 
                      : 'bg-muted/30'
                  }`}>
                    <p className="text-xs text-muted-foreground mb-1">Värme</p>
                    <div className="flex items-center justify-center gap-1.5">
                      <Flame className={`h-4 w-4 ${isActivelyHeating ? 'text-orange-500' : 'text-muted-foreground'}`} />
                      <span className={`text-sm font-medium ${isActivelyHeating ? 'text-orange-600 dark:text-orange-400' : 'text-muted-foreground'}`}>
                        {controller.heating_enabled ? (isActivelyHeating ? 'PÅ' : 'Av') : 'Ej aktiv'}
                      </span>
                    </div>
                  </div>
                  
                  {/* Cooling status */}
                  <div className={`rounded-lg p-3 text-center transition-all ${
                    isActivelyCooling 
                      ? 'bg-blue-500/20 border border-blue-500/30' 
                      : 'bg-muted/30'
                  }`}>
                    <p className="text-xs text-muted-foreground mb-1">Kyla</p>
                    <div className="flex items-center justify-center gap-1.5">
                      <Snowflake className={`h-4 w-4 ${isActivelyCooling ? 'text-blue-500' : 'text-muted-foreground'}`} />
                      <span className={`text-sm font-medium ${isActivelyCooling ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'}`}>
                        {controller.cooling_enabled ? (isActivelyCooling ? 'PÅ' : 'Av') : 'Ej aktiv'}
                      </span>
                    </div>
                  </div>
                </div>
                
                {/* Cooler notice */}
                {isCooler && (
                  <div className="mt-3 p-2 bg-blue-500/10 border border-blue-500/20 rounded-md">
                    <p className="text-xs text-blue-600 dark:text-blue-400 flex items-center gap-2">
                      <Snowflake className="h-3 w-3" />
                      Denna controller styr glykolkylaren och kan inte köra fermenteringsprofiler
                    </p>
                  </div>
                )}
                
                {/* Pill linking - only show for non-cooler controllers */}
                {!isCooler && (() => {
                  const linkedPill = controller.linked_pill_id 
                    ? pills.find(p => p.pill_id === controller.linked_pill_id) 
                    : null;
                  
                  return (
                    <div className="mt-3 pt-3 border-t border-border/50">
                      {linkedPill ? (
                        /* Connected pill - nice visual card */
                        <div 
                          className="flex items-center gap-3 p-2.5 rounded-lg border transition-all"
                          style={{ 
                            backgroundColor: `${linkedPill.color}08`,
                            borderColor: `${linkedPill.color}25`,
                          }}
                        >
                          <div 
                            className="p-2 rounded-lg shrink-0"
                            style={{ backgroundColor: `${linkedPill.color}20` }}
                          >
                            <Pill className="h-4 w-4" style={{ color: linkedPill.color }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate" style={{ color: linkedPill.color }}>
                              {linkedPill.name}
                            </p>
                            {linkedPill.last_update && (
                              <p className="text-[11px] text-muted-foreground mt-0.5">
                                Senast sedd {formatDistanceToNow(new Date(linkedPill.last_update), { 
                                  addSuffix: false, 
                                  locale: sv 
                                })} sedan
                              </p>
                            )}
                          </div>
                          <Select
                            value={controller.linked_pill_id || "none"}
                            onValueChange={(value) => handleLinkPill(controller.controller_id, value === "none" ? null : value)}
                            disabled={updating}
                          >
                            <SelectTrigger className="w-auto h-7 px-2 gap-1 text-xs border-border/30 bg-background/50">
                              <span className="text-muted-foreground">Byt</span>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">
                                <div className="flex items-center gap-2">
                                  <Unlink className="h-3 w-3 text-muted-foreground" />
                                  <span>Koppla bort</span>
                                </div>
                              </SelectItem>
                              {pills.map((pill) => {
                                const linkedPillIds = getLinkedPillIds(controller.controller_id);
                                const isAlreadyLinked = linkedPillIds.includes(pill.pill_id);
                                return (
                                  <SelectItem 
                                    key={pill.pill_id} 
                                    value={pill.pill_id}
                                    disabled={isAlreadyLinked}
                                  >
                                    <div className="flex items-center gap-2">
                                      <Pill className="h-3 w-3" style={{ color: pill.color }} />
                                      <span>{pill.name}</span>
                                      {isAlreadyLinked && <span className="text-xs text-muted-foreground">(upptagen)</span>}
                                    </div>
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                        </div>
                      ) : (
                        /* No pill linked - compact selector */
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Pill className="h-4 w-4" />
                            <span>Pill:</span>
                          </div>
                          <Select
                            value="none"
                            onValueChange={(value) => handleLinkPill(controller.controller_id, value === "none" ? null : value)}
                            disabled={updating}
                          >
                            <SelectTrigger className="w-[180px] h-8">
                              <SelectValue placeholder="Välj pill..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">
                                <div className="flex items-center gap-2">
                                  <Unlink className="h-3 w-3 text-muted-foreground" />
                                  <span>Ingen koppling</span>
                                </div>
                              </SelectItem>
                              {pills.map((pill) => {
                                const linkedPillIds = getLinkedPillIds(controller.controller_id);
                                const isAlreadyLinked = linkedPillIds.includes(pill.pill_id);
                                return (
                                  <SelectItem 
                                    key={pill.pill_id} 
                                    value={pill.pill_id}
                                    disabled={isAlreadyLinked}
                                  >
                                    <div className="flex items-center gap-2">
                                      <Pill className="h-3 w-3" style={{ color: pill.color }} />
                                      <span>{pill.name}</span>
                                      {isAlreadyLinked && <span className="text-xs text-muted-foreground">(upptagen)</span>}
                                    </div>
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  );
                })()}
                
                {/* Temperature limits */}
                <div className="mt-3 pt-3 border-t border-border/50">
                  {editingLimitsId === controller.controller_id ? (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                      <div className="flex items-center gap-2 flex-1">
                        <Settings2 className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">Min:</span>
                        <Input
                          type="number"
                          value={tempMinTemp}
                          onChange={(e) => setTempMinTemp(e.target.value)}
                          placeholder="°C"
                          className="w-20 h-8"
                          disabled={updating}
                        />
                        <span className="text-sm text-muted-foreground">Max:</span>
                        <Input
                          type="number"
                          value={tempMaxTemp}
                          onChange={(e) => setTempMaxTemp(e.target.value)}
                          placeholder="°C"
                          className="w-20 h-8"
                          disabled={updating}
                        />
                      </div>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleUpdateLimits(controller.controller_id)}
                          disabled={updating}
                          className="h-8 w-8 p-0 text-green-600 hover:text-green-700 hover:bg-green-500/10"
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={handleCancelEditLimits}
                          disabled={updating}
                          className="h-8 w-8 p-0"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleStartEditLimits(controller)}
                      className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors group w-full"
                    >
                      <Settings2 className="h-4 w-4 group-hover:text-primary transition-colors" />
                      <span>Temperaturintervall:</span>
                      <span className="font-medium text-foreground">
                        {controller.min_target_temp ?? -5}°C — {controller.max_target_temp ?? 25}°C
                      </span>
                    </button>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
