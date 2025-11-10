import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { BrewChart } from "./BrewChart";
import { SyncCountdown } from "./SyncCountdown";
import { RaptControllerDialog } from "./RaptControllerDialog";
import { BrewEventDialog } from "./BrewEventDialog";
import { BrewDeviceLinkDialog } from "./BrewDeviceLinkDialog";
import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Settings, Loader2, Droplets, Thermometer, TrendingDown, Wine, Beer, Battery, ChevronLeft, ChevronRight, Pill, AirVent } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { toast as sonnerToast } from "sonner";
import useEmblaCarousel from "embla-carousel-react";
import { useIsMobile } from "@/hooks/use-mobile";

interface BrewEvent {
  id: string;
  brew_id: string;
  event_type: string;
  event_date: string;
  notes: string | null;
}

interface BrewData {
  id: string;
  batch_id: string;
  name: string;
  style: string;
  batchNumber: string;
  status: string;
  currentSG: number;
  currentTemp: number;
  attenuation: number;
  abv: number;
  originalGravity: number;
  finalGravity: number;
  lastUpdate: string;
  lastUpdateRaw: string | null; // Store raw timestamp for comparison
  battery: number | null;
  sgData: Array<{ date: string; value: number; temp: number }>;
  fermentationRate: number | null; // SG change per 24h based on last 2 hours
  coldcrashAcknowledged: boolean;
  events: BrewEvent[];
  linked_controller_id: string | null;
  linked_pill_id: string | null;
}

interface PillData {
  id: string;
  pill_id: string;
  name: string;
  color: string;
  battery_level: number;
  last_update: string | null;
}

interface TempController {
  id: string;
  controller_id: string;
  name: string;
  current_temp: number | null;
  pill_temp: number | null;
  target_temp: number | null;
  last_update: string | null;
  min_target_temp: number | null;
  max_target_temp: number | null;
  cooling_enabled: boolean | null;
  heating_enabled: boolean | null;
  heating_utilisation: number | null;
  linked_pill_id: string | null;
}

export function BrewingDashboard() {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [brews, setBrews] = useState<BrewData[]>([]);
  const [pills, setPills] = useState<PillData[]>([]);
  const [controllers, setControllers] = useState<TempController[]>([]);
  const [selectedController, setSelectedController] = useState<TempController | null>(null);
  const [controllerDialogOpen, setControllerDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [updatedFields, setUpdatedFields] = useState<Record<string, Record<string, boolean>>>({});
  const [brewEvents, setBrewEvents] = useState<Record<string, BrewEvent[]>>({});
  const navigate = useNavigate();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: false, align: "center" });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [raptControllers, setRaptControllers] = useState<TempController[]>([]);
  const [raptPills, setRaptPills] = useState<PillData[]>([]);
  const [deviceLinkDialog, setDeviceLinkDialog] = useState<{
    open: boolean;
    brewId: string;
    brewName: string;
    currentControllerId: string | null;
    currentPillId: string | null;
  }>({
    open: false,
    brewId: "",
    brewName: "",
    currentControllerId: null,
    currentPillId: null,
  });
  
  // Ref to hold the latest brews state for realtime comparison
  const brewsRef = useRef<BrewData[]>([]);
  
  // Update ref whenever brews changes
  useEffect(() => {
    brewsRef.current = brews;
  }, [brews]);

  useEffect(() => {
    // Update time every second to keep everything in sync
    const updateTime = () => setCurrentTime(new Date());
    updateTime(); // Initial update
    
    const timer = setInterval(updateTime, 1000); // Update every second

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    loadBrews();
    loadRaptData();
  }, []);

  // Re-sort brews when controllers change
  useEffect(() => {
    if (brews.length === 0 || controllers.length === 0) return;
    
    setBrews(prevBrews => {
      const sorted = [...prevBrews].sort((a, b) => {
        const aControllerIndex = controllers.findIndex(c => c.controller_id === a.linked_controller_id);
        const bControllerIndex = controllers.findIndex(c => c.controller_id === b.linked_controller_id);
        
        // If both have linked controllers, sort by controller order
        if (aControllerIndex !== -1 && bControllerIndex !== -1) {
          return aControllerIndex - bControllerIndex;
        }
        
        // Brews with linked controllers come before those without
        if (aControllerIndex !== -1) return -1;
        if (bControllerIndex !== -1) return 1;
        
        // If neither has a linked controller, maintain original order
        return 0;
      });
      
      // Only update if order actually changed
      const orderChanged = sorted.some((brew, index) => brew.id !== prevBrews[index].id);
      return orderChanged ? sorted : prevBrews;
    });
  }, [controllers]);

  const loadBrewEvents = async () => {
    try {
      const { data, error } = await supabase
        .from('brew_events')
        .select('*')
        .order('event_date');
      
      if (error) throw error;
      
      // Group events by brew_id
      const eventsByBrew: Record<string, BrewEvent[]> = {};
      (data || []).forEach((event: BrewEvent) => {
        if (!eventsByBrew[event.brew_id]) {
          eventsByBrew[event.brew_id] = [];
        }
        eventsByBrew[event.brew_id].push(event);
      });
      
      setBrewEvents(eventsByBrew);
    } catch (error) {
      console.error('Error loading brew events:', error);
    }
  };

  useEffect(() => {
    if (!emblaApi) return;

    const onSelect = () => {
      setSelectedIndex(emblaApi.selectedScrollSnap());
    };

    emblaApi.on("select", onSelect);
    onSelect();

    return () => {
      emblaApi.off("select", onSelect);
    };
  }, [emblaApi]);

  useEffect(() => {
    // Set up realtime subscription for brew readings
    const brewChannel = supabase
      .channel('brew-readings-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'brew_readings'
        },
        (payload) => {
          console.log('Realtime update:', payload)
          
          // Update only the specific brew that changed
          if (payload.eventType === 'UPDATE' && payload.new) {
            const updatedReading = payload.new as any;
            
            // Find the current brew from screen state using ref
            const currentBrew = brewsRef.current.find(b => b.batch_id === updatedReading.batch_id);
            
            if (!currentBrew) {
              // If brew not found, just reload
              loadBrews();
              return;
            }
            
            // Track which fields actually changed to a different VISIBLE value compared to what's on screen
            const changedFields: Record<string, boolean> = {};
            
            // For SG, only trigger glow if the change is visible in 3 decimals
            if (updatedReading.current_sg !== undefined) {
              const newSGRounded = Number(updatedReading.current_sg.toFixed(3));
              const screenSGRounded = Number(currentBrew.currentSG.toFixed(3));
              if (newSGRounded !== screenSGRounded) {
                changedFields.sg = true;
              }
            }
            
            // For temp, only trigger if visible change (rounded to integer)
            if (updatedReading.current_temp !== undefined) {
              const newTempRounded = Math.round(updatedReading.current_temp);
              const screenTempRounded = Math.round(currentBrew.currentTemp);
              if (newTempRounded !== screenTempRounded) {
                changedFields.temp = true;
              }
            }
            
            // For attenuation, only trigger if visible change (integer)
            if (updatedReading.attenuation !== undefined) {
              if (Math.round(updatedReading.attenuation) !== Math.round(currentBrew.attenuation)) {
                changedFields.attenuation = true;
              }
            }
            
            // For ABV, only trigger if visible change (1 decimal)
            if (updatedReading.abv !== undefined) {
              const newABVRounded = Number(updatedReading.abv.toFixed(1));
              const screenABVRounded = Number(currentBrew.abv.toFixed(1));
              if (newABVRounded !== screenABVRounded) {
                changedFields.abv = true;
              }
            }
            
            // For battery, only trigger if visible change (rounded to integer)
            if (updatedReading.battery !== undefined && updatedReading.battery !== null && currentBrew.battery !== null) {
              if (Math.round(updatedReading.battery) !== Math.round(currentBrew.battery)) {
                changedFields.battery = true;
              }
            }
            
            // Compare last_update timestamp from database with what's on screen
            const newLastUpdate = updatedReading.last_update;
            const screenLastUpdate = currentBrew.lastUpdateRaw;
            
            console.log('Checking last_update:', {
              screen: screenLastUpdate,
              new: newLastUpdate,
              changed: newLastUpdate !== screenLastUpdate
            });
            
            if (newLastUpdate !== screenLastUpdate && newLastUpdate !== undefined && screenLastUpdate !== undefined) {
              changedFields.cardGlow = true;
              console.log('Card glow activated for batch:', updatedReading.batch_id);
            }
            
            setBrews(prevBrews => 
              prevBrews.map(brew => {
                if (brew.batch_id === updatedReading.batch_id) {
                  const originalSgData = updatedReading.sg_data || [];
                  let newSgData = originalSgData;
                  
                  // If status is Conditioning or Completed, freeze the chart
                  if (updatedReading.status === 'Conditioning' || updatedReading.status === 'Completed') {
                    const sortedData = [...newSgData].sort((a, b) => 
                      new Date(a.date).getTime() - new Date(b.date).getTime()
                    );
                    
                    let cutoffIndex = sortedData.length - 1;
                    for (let i = sortedData.length - 1; i > 0; i--) {
                      const recentData = sortedData.slice(Math.max(0, i - 10), i + 1);
                      const rate = calculateFermentationRate(recentData);
                      
                      if (rate !== null && Math.abs(rate) >= 0.001) {
                        cutoffIndex = i;
                        break;
                      }
                    }
                    
                    newSgData = sortedData.slice(0, cutoffIndex + 1);
                  }
                  
                  // Always calculate fermentation rate on ALL data, not frozen data
                  const newFermentationRate = calculateFermentationRate(originalSgData);
                  
                  // Check if fermentation has stopped (rate is 0.000) and not yet acknowledged
                  if (
                    newFermentationRate !== null && 
                    Math.abs(newFermentationRate) < 0.0005 && // Essentially 0.000 when rounded to 3 decimals
                    !brew.coldcrashAcknowledged
                  ) {
                    sonnerToast(`${updatedReading.name} är klar! 🍺`, {
                      description: "Jäsningen är färdig (0.000/dag). Dags för Coldcrash!",
                      duration: Infinity,
                      action: {
                        label: 'Kvittera',
                        onClick: async () => {
                          // Update database to acknowledge coldcrash
                          await supabase
                            .from('brew_readings')
                            .update({ coldcrash_acknowledged: true })
                            .eq('batch_id', brew.batch_id);
                        },
                      },
                    });
                  }
                  
                  return {
                    ...brew,
                    currentSG: updatedReading.current_sg,
                    currentTemp: updatedReading.current_temp,
                    attenuation: updatedReading.attenuation,
                    abv: updatedReading.abv,
                    battery: updatedReading.battery,
                    lastUpdate: updatedReading.last_update ? 
                      new Date(updatedReading.last_update).toLocaleString('sv-SE', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      }) : 'Ingen data',
                    lastUpdateRaw: updatedReading.last_update,
                    sgData: newSgData,
                    fermentationRate: newFermentationRate,
                    coldcrashAcknowledged: updatedReading.coldcrash_acknowledged ?? brew.coldcrashAcknowledged
                  };
                }
                return brew;
              })
            );
            
            // Only set glow effect if at least one tracked field actually changed
            if (Object.keys(changedFields).length > 0) {
              setUpdatedFields(prev => ({
                ...prev,
                [updatedReading.batch_id]: changedFields
              }));
              
              // Remove glow after 2 minutes
              setTimeout(() => {
                setUpdatedFields(prev => {
                  const newFields = { ...prev };
                  delete newFields[updatedReading.batch_id];
                  return newFields;
                });
              }, 120000);
            }
          } else {
            // For INSERT/DELETE, reload all data
            loadBrews();
          }
        }
      )
      .subscribe()

    // Set up realtime for RAPT Pills
    const pillsChannel = supabase
      .channel('rapt_pills_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rapt_pills'
        },
        () => {
          loadRaptData();
        }
      )
      .subscribe();

    // Set up realtime for RAPT Temp Controllers
    const controllersChannel = supabase
      .channel('temp-controllers-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rapt_temp_controllers'
        },
        () => {
          loadRaptData();
        }
      )
      .subscribe();

    // Set up realtime for selected RAPT Pills
    const selectedPillsChannel = supabase
      .channel('selected_rapt_pills_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'selected_rapt_pills'
        },
        () => {
          loadRaptData();
        }
      )
      .subscribe();

    // Set up realtime for selected RAPT Temp Controllers
    const selectedControllersChannel = supabase
      .channel('selected_rapt_temp_controllers_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'selected_rapt_temp_controllers'
        },
        () => {
          loadRaptData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(brewChannel);
      supabase.removeChannel(pillsChannel);
      supabase.removeChannel(controllersChannel);
      supabase.removeChannel(selectedPillsChannel);
      supabase.removeChannel(selectedControllersChannel);
    }
  }, []);

  // Calculate fermentation rate (SG change per 24h based on recent data)
  const calculateFermentationRate = (sgData: Array<{ date: string; value: number; temp: number }>): number | null => {
    if (!sgData || sgData.length < 2) return null;
    
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    // Filter readings from last 24 hours
    const last24h = sgData.filter(d => new Date(d.date) >= twentyFourHoursAgo).sort((a, b) => 
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    
    // If we have 24h data, use it
    if (last24h.length >= 2) {
      const firstReading = last24h[0];
      const lastReading = last24h[last24h.length - 1];
      
      const timeDiffMs = new Date(lastReading.date).getTime() - new Date(firstReading.date).getTime();
      const timeDiffHours = timeDiffMs / (1000 * 60 * 60);
      
      if (timeDiffHours === 0) return null;
      
      const sgDiff = firstReading.value - lastReading.value;
      const ratePerHour = sgDiff / timeDiffHours;
      return ratePerHour * 24;
    }
    
    // Otherwise, use max 7 days of recent data to avoid skewing by old fermentation
    const last7days = sgData.filter(d => new Date(d.date) >= sevenDaysAgo).sort((a, b) => 
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    
    const dataToUse = last7days.length >= 2 ? last7days : [...sgData].sort((a, b) => 
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    
    if (dataToUse.length < 2) return null;
    
    const firstReading = dataToUse[0];
    const lastReading = dataToUse[dataToUse.length - 1];
    
    const timeDiffMs = new Date(lastReading.date).getTime() - new Date(firstReading.date).getTime();
    const timeDiffHours = timeDiffMs / (1000 * 60 * 60);
    
    if (timeDiffHours === 0) return null;
    
    const sgDiff = firstReading.value - lastReading.value;
    const ratePerHour = sgDiff / timeDiffHours;
    return ratePerHour * 24;
  };

  const loadBrews = async () => {
    try {
      setLoading(true);

      // First get selected and visible brews
      const { data: selectedBrews, error: selectedError } = await supabase
        .from('selected_brews')
        .select('batch_id')
        .eq('is_visible', true)
        .order('display_order');

      if (selectedError) throw selectedError;

      if (!selectedBrews || selectedBrews.length === 0) {
        setBrews([]);
        setLoading(false);
        return;
      }

      const selectedBatchIds = selectedBrews.map(sb => sb.batch_id);

      // Get brew readings only for selected brews
      const { data: brewReadings, error: readingsError } = await supabase
        .from('brew_readings')
        .select('*')
        .in('batch_id', selectedBatchIds)
        .order('created_at', { ascending: false })

      if (readingsError) throw readingsError;

      if (!brewReadings || brewReadings.length === 0) {
        setBrews([]);
        setLoading(false);
        return;
      }

      // Load events FIRST before mapping brew data
      const { data: eventsData, error: eventsError } = await supabase
        .from('brew_events')
        .select('*')
        .order('event_date');
      
      // Group events by brew_id
      const eventsByBrewId: Record<string, BrewEvent[]> = {};
      (eventsData || []).forEach((event: BrewEvent) => {
        if (!eventsByBrewId[event.brew_id]) {
          eventsByBrewId[event.brew_id] = [];
        }
        eventsByBrewId[event.brew_id].push(event);
      });

      // Transform database data to component format
      const brewsData = brewReadings.map((reading: any) => {
        const originalSgData = reading.sg_data || [];
        let sgData = originalSgData;
        
        // If status is Conditioning or Completed, freeze the chart at the last fermentation point
        if (reading.status === 'Conditioning' || reading.status === 'Completed') {
          // Find the last point where fermentation was active (SG was still changing)
          // We'll keep data up to the point where SG stopped changing significantly
          const sortedData = [...sgData].sort((a, b) => 
            new Date(a.date).getTime() - new Date(b.date).getTime()
          );
          
          // Find the cutoff point where fermentation essentially stopped
          let cutoffIndex = sortedData.length - 1;
          for (let i = sortedData.length - 1; i > 0; i--) {
            const recentData = sortedData.slice(Math.max(0, i - 10), i + 1);
            const rate = calculateFermentationRate(recentData);
            
            // If we find a point where fermentation was still active, that's our cutoff
            if (rate !== null && Math.abs(rate) >= 0.001) {
              cutoffIndex = i;
              break;
            }
          }
          
          // Keep data up to the cutoff point plus a small buffer
          sgData = sortedData.slice(0, cutoffIndex + 1);
        }
        
        // Always calculate fermentation rate on ALL data, not frozen data
        const fermentationRate = calculateFermentationRate(originalSgData);
        
        // Check if fermentation has stopped on initial load and not yet acknowledged
        if (
          fermentationRate !== null && 
          Math.abs(fermentationRate) < 0.0005 && // Essentially 0.000 when rounded to 3 decimals
          !reading.coldcrash_acknowledged
        ) {
          sonnerToast(`${reading.name} är klar! 🍺`, {
            description: "Jäsningen är färdig (0.000/dag). Dags för Coldcrash!",
            duration: Infinity,
            action: {
              label: 'Kvittera',
              onClick: async () => {
                // Update database to acknowledge coldcrash
                await supabase
                  .from('brew_readings')
                  .update({ coldcrash_acknowledged: true })
                  .eq('batch_id', reading.batch_id);
              },
            },
          });
        }
        
        return {
          id: reading.id,
          batch_id: reading.batch_id,
          name: reading.name,
          style: reading.style,
          batchNumber: reading.batch_number,
          status: reading.status,
          currentSG: reading.current_sg,
          currentTemp: reading.current_temp,
          attenuation: reading.attenuation,
          abv: reading.abv,
          originalGravity: reading.original_gravity,
          finalGravity: reading.final_gravity,
          lastUpdate: reading.last_update ? 
            new Date(reading.last_update).toLocaleString('sv-SE', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            }) : 'Ingen data',
          lastUpdateRaw: reading.last_update,
          battery: reading.battery,
          sgData: sgData,
          fermentationRate: fermentationRate,
          coldcrashAcknowledged: reading.coldcrash_acknowledged ?? false,
          events: eventsByBrewId[reading.id] || [],
          linked_controller_id: reading.linked_controller_id || null,
          linked_pill_id: reading.linked_pill_id || null,
        };
      });

      setBrews(brewsData);

    } catch (error) {
      console.error('Error loading brews:', error);
      toast({
        title: "Fel",
        description: "Kunde inte ladda bryggdata",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Helper function to find matching pill/controller for a brew
  const findDevicesForBrew = (brew: BrewData): { pill: PillData | null; controller: TempController | null } => {
    // First, check for manual connections
    if (brew.linked_controller_id) {
      const manualController = controllers.find(c => c.controller_id === brew.linked_controller_id) || null;
      const manualPill = brew.linked_pill_id 
        ? pills.find(p => p.pill_id === brew.linked_pill_id) || null
        : null;
      
      if (manualController || manualPill) {
        return { pill: manualPill, controller: manualController };
      }
    }

    // Fallback to automatic matching
    let matchingPill: PillData | null = null;
    let matchingController: TempController | null = null;

    // Try to match by color name in brew name
    const brewNameLower = brew.name.toLowerCase();
    const colorKeywords = ['röd', 'red', 'blå', 'blue', 'grön', 'green', 'gul', 'gyllene', 'guld', 'golden', 'yellow', 'lila', 'purple', 'rosa', 'pink', 'orange', 'cyan', 'lime', 'amber', 'bärnsten', 'turkos', 'teal', 'indigo', 'violet', 'violett', 'fuchsia', 'rose', 'himmel', 'sky', 'smaragd', 'emerald'];

    // Find color keywords in brew name
    const brewColors = colorKeywords.filter(color => brewNameLower.includes(color));

    // Try to match pill by color
    if (brewColors.length > 0) {
      matchingPill = pills.find(pill => {
        const pillNameLower = pill.name.toLowerCase();
        return brewColors.some(color => pillNameLower.includes(color));
      }) || null;
    }

    // Try to match controller by color  
    if (brewColors.length > 0) {
      matchingController = controllers.find(ctrl => {
        const ctrlNameLower = ctrl.name.toLowerCase();
        return brewColors.some(color => ctrlNameLower.includes(color));
      }) || null;
    }

    // If no color match, try temperature matching (±3°C tolerance)
    if (!matchingController && !matchingPill) {
      const brewTemp = brew.currentTemp;
      
      // Try to match controller by temperature
      matchingController = controllers.find(ctrl => {
        if (ctrl.pill_temp !== null) {
          return Math.abs(ctrl.pill_temp - brewTemp) <= 3;
        }
        if (ctrl.current_temp !== null) {
          return Math.abs(ctrl.current_temp - brewTemp) <= 3;
        }
        return false;
      }) || null;

      // If controller matched, use its linked pill
      if (matchingController && matchingController.linked_pill_id) {
        matchingPill = pills.find(p => p.pill_id === matchingController.linked_pill_id) || null;
      }
    }

    // If we found a controller but no pill, check if controller has a linked pill
    if (matchingController && !matchingPill && matchingController.linked_pill_id) {
      matchingPill = pills.find(p => p.pill_id === matchingController.linked_pill_id) || null;
    }

    return { pill: matchingPill, controller: matchingController };
  };

  const loadRaptData = async () => {
    try {
      console.log('Loading RAPT data from public edge function...');
      
      const { data, error } = await supabase.functions.invoke('get-public-rapt-data');

      if (error) {
        console.error('Error loading RAPT data:', error);
        return;
      }

      if (!data.success) {
        console.error('Failed to load RAPT data:', data.error);
        return;
      }

      setPills(data.pills || []);
      setControllers(data.controllers || []);
      setRaptPills(data.pills || []);
      setRaptControllers(data.controllers || []);
      
      console.log(`Loaded ${data.pills?.length || 0} pills and ${data.controllers?.length || 0} controllers`);
    } catch (error) {
      console.error('Error loading RAPT data:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen w-full bg-background flex items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  if (brews.length === 0) {
    return (
      <div className="h-screen w-full bg-background flex flex-col overflow-hidden p-4">
        <div className="mb-4 relative">
          <p className="absolute right-0 top-0 text-xs text-muted-foreground">
            {currentTime.toLocaleDateString("sv-SE", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}{" "}
            {currentTime.toLocaleTimeString("sv-SE", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
          
          <div className="text-center py-2">
            <h1 className="text-4xl font-bold bg-gradient-beer bg-clip-text text-transparent leading-tight pb-1">
              Bryggövervakare
            </h1>
          </div>
        </div>

        <Card className="max-w-2xl mx-auto p-8 text-center">
          <h2 className="text-2xl font-bold mb-4">Inga öl valda</h2>
          <p className="text-muted-foreground mb-6">
            Gå till inställningar för att välja vilka öl du vill visa på dashboarden
          </p>
          <Button onClick={() => navigate('/settings')}>
            <Settings className="mr-2 h-4 w-4" />
            Öppna Inställningar
          </Button>
        </Card>
      </div>
    );
  }

  // Dynamic grid layout based on number of brews
  const getGridLayout = () => {
    const count = brews.length;
    if (count === 1) return "grid-cols-1 grid-rows-1";
    if (count === 2) return "grid-cols-2 grid-rows-1";
    if (count === 3) return "grid-cols-3 grid-rows-1";
    if (count === 4) return "grid-cols-2 grid-rows-2";
    return "grid-cols-3"; // 5+ brews still use 3 columns with scrolling
  };

  // Calculate temperature color - interpolate from blue (0°C) to red (30°C)
  const getTempColor = (temp: number): { hsl: string; rgb: string } => {
    // Clamp temperature between 0 and 30
    const clampedTemp = Math.min(Math.max(temp, 0), 30);
    // Calculate hue: 200 (blue) at 0°C, 0 (red) at 30°C
    const hue = 200 - (clampedTemp / 30) * 200;
    // Full saturation and 50% lightness for vibrant colors
    return {
      hsl: `${hue} 80% 55%`,
      rgb: hslToRgb(hue, 0.8, 0.55)
    };
  };

  // Extract color from controller name (like "Red", "Röd", "Blue", "Blå", etc.)
  const getControllerColor = (name: string): string => {
    const lowerName = name.toLowerCase();
    
    // Map of color keywords (English and Swedish) to hex values
    const colorMatches: Array<[string[], string]> = [
      [['red', 'röd'], '#ef4444'],
      [['blue', 'blå'], '#3b82f6'],
      [['green', 'grön'], '#22c55e'],
      [['yellow', 'gul'], '#eab308'],
      [['purple', 'lila'], '#a855f7'],
      [['pink', 'rosa'], '#ec4899'],
      [['orange'], '#f97316'],
      [['cyan'], '#06b6d4'],
      [['lime'], '#84cc16'],
      [['amber', 'bärnsten'], '#f59e0b'],
      [['teal', 'turkos'], '#14b8a6'],
      [['indigo'], '#6366f1'],
      [['violet', 'violett'], '#8b5cf6'],
      [['fuchsia'], '#d946ef'],
      [['rose'], '#f43f5e'],
      [['sky', 'himmel'], '#0ea5e9'],
      [['emerald', 'smaragd'], '#10b981'],
      [['slate', 'skiffer'], '#64748b'],
      [['gray', 'grey', 'grå'], '#6b7280'],
      [['zinc', 'zink'], '#71717a'],
      [['neutral', 'neutral'], '#737373'],
      [['stone', 'sten'], '#78716c'],
      [['white', 'vit'], '#f1f5f9'],
      [['black', 'svart'], '#1e293b'],
    ];

    for (const [keywords, hex] of colorMatches) {
      if (keywords.some(keyword => lowerName.includes(keyword))) {
        return hex;
      }
    }
    
    // Default to primary theme color if no color found
    return 'currentColor';
  };

  // Convert HSL to RGB for inline styles
  const hslToRgb = (h: number, s: number, l: number): string => {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    
    if (h < 60) { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    
    return `rgb(${Math.round((r + m) * 255)}, ${Math.round((g + m) * 255)}, ${Math.round((b + m) * 255)})`;
  };

  return (
    <div className="h-screen w-screen bg-background flex flex-col overflow-hidden">
      {/* Header Bar */}
      <div className="h-[11%] flex items-center justify-between border-b border-border/50 backdrop-blur-sm bg-background/80 flex-shrink-0 overflow-visible px-6 gap-4" style={{ containerType: 'size' }}>
        <div className="relative">
          {isMobile ? (
            <div className="relative inline-block">
              <div className="absolute inset-0 rounded-full animate-pulse" style={{
                boxShadow: '0 0 20px 8px hsl(38 90% 60% / 0.6)',
                filter: 'blur(8px)'
              }} />
              <Beer 
                className="h-8 w-8 relative z-10" 
                style={{ 
                  color: 'hsl(38 90% 60%)',
                  filter: 'drop-shadow(0 0 16px hsl(38 90% 60% / 0.8))'
                }}
              />
            </div>
          ) : (
            <h1 className="font-bold brewing-title leading-relaxed pb-0.5 relative z-0" style={{ 
              fontSize: 'min(calc(60cqh * 0.8), calc(100cqw * 0.035))',
              background: 'linear-gradient(135deg, hsl(38 90% 60%) 0%, hsl(45 95% 65%) 100%)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent'
            }}>
              Bryggövervakare
            </h1>
          )}
          {/* Extra bubbles - hide on mobile */}
          {!isMobile && (
            <>
              <span className="absolute text-[0.3em] opacity-40 z-10" style={{ 
                left: '5%', 
                top: '20%',
                color: 'hsl(38 90% 60%)',
                animation: 'bubble-rise 4s infinite ease-in, bubble-float 2.5s infinite ease-in-out',
                animationDelay: '0.5s, 0.2s'
              }}>○</span>
              <span className="absolute text-[0.25em] opacity-40 z-10" style={{ 
                left: '35%', 
                top: '50%',
                color: 'hsl(45 95% 65%)',
                animation: 'bubble-rise 3.5s infinite ease-in, bubble-float 2s infinite ease-in-out',
                animationDelay: '2s, 1s'
              }}>○</span>
              <span className="absolute text-[0.35em] opacity-40 z-10" style={{ 
                left: '55%', 
                top: '15%',
                color: 'hsl(38 90% 60%)',
                animation: 'bubble-rise 3.8s infinite ease-in, bubble-float 2.2s infinite ease-in-out',
                animationDelay: '3s, 1.5s'
              }}>○</span>
              <span className="absolute text-[0.28em] opacity-40 z-10" style={{ 
                left: '88%', 
                top: '40%',
                color: 'hsl(45 95% 65%)',
                animation: 'bubble-rise 4.2s infinite ease-in, bubble-float 2.8s infinite ease-in-out',
                animationDelay: '1s, 0.5s'
              }}>○</span>
            </>
          )}
        </div>
        
        <div className={`flex items-center ${isMobile ? 'gap-2 flex-1 overflow-hidden' : 'gap-4'}`}>
          <div data-name="RaptMain" className={`flex items-stretch h-full flex-nowrap ${isMobile ? 'gap-1.5 overflow-x-auto scrollbar-hide flex-1' : 'gap-3 justify-end'}`}>
            {/* Temp Controllers with their linked Pills */}
            {controllers.length > 0 && controllers.map((controller) => {
              const controllerColor = getControllerColor(controller.name);
              
              // Find the pill that belongs to this controller
              const linkedPill = pills.find(p => p.pill_id === controller.linked_pill_id);
              const isPillStale = linkedPill?.last_update ? 
                ((new Date().getTime() - new Date(linkedPill.last_update).getTime()) / (1000 * 60 * 60)) > 24 
                : true;
              
              return (
              <div 
                key={controller.id}
                className={`flex flex-col items-start justify-start py-0.5 gap-1 ${isMobile ? 'w-[5.5rem]' : 'w-[8rem]'}`}
              >
                {/* Controller */}
                <div 
                  className={`flex flex-row items-center justify-between cursor-pointer hover:opacity-80 transition-opacity ${isMobile ? 'h-7' : 'h-8'} w-full gap-1.5`}
                  onClick={() => {
                    setSelectedController(controller);
                    setControllerDialogOpen(true);
                  }}
                  title={`${controller.name}\n${controller.pill_temp !== null ? `Pill: ${controller.pill_temp.toFixed(1)}°C` : `Inbyggd: ${controller.current_temp !== null ? controller.current_temp.toFixed(1) : '--'}°C`}\nMål: ${controller.target_temp !== null ? controller.target_temp.toFixed(1) : '--'}°C\n\nKlicka för att ändra inställningar`}
                >
                  <div className="flex items-center justify-center flex-shrink-0 bg-background/30 rounded p-0.5" style={{ 
                    width: isMobile ? '1.75rem' : '2rem',
                    height: isMobile ? '1.75rem' : '2rem'
                  }}>
                    <AirVent 
                      style={{
                        width: '100%',
                        height: '100%',
                        color: controllerColor,
                      }}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span 
                      className="font-bold tabular-nums block text-left whitespace-nowrap"
                      style={{
                        fontSize: isMobile ? 'min(calc(50cqh * 0.42), calc(100cqw * 0.024))' : 'min(calc(50cqh * 0.48), calc(100cqw * 0.028))',
                        color: linkedPill?.color || 'hsl(var(--foreground))',
                      }}
                    >
                      {controller.pill_temp !== null 
                        ? `${controller.pill_temp.toFixed(1)}°C` 
                        : controller.current_temp !== null 
                          ? `${controller.current_temp.toFixed(1)}°C` 
                          : '--°C'
                      }
                    </span>
                  </div>
                </div>
                
                {/* Linked Pill (if exists) */}
                {linkedPill ? (
                  <div 
                    className={`relative flex flex-row items-center justify-between transition-opacity ${isMobile ? 'h-6' : 'h-7'} w-full gap-1.5 ${isPillStale ? 'opacity-50' : ''}`}
                    title={`${linkedPill.name}\nBatteri: ${linkedPill.battery_level}%${isPillStale ? '\n⚠️ Ingen uppdatering på >24h' : ''}`}
                  >
                    <div className="relative flex items-center justify-center flex-shrink-0 bg-background/30 rounded p-0.5" style={{ 
                      width: isMobile ? '1.5rem' : '1.75rem',
                      height: isMobile ? '1.5rem' : '1.75rem'
                    }}>
                      <Pill
                        style={{
                          width: '100%',
                          height: '100%'
                        }}
                        color={linkedPill.color}
                        strokeWidth={2.5}
                        className={`drop-shadow-md ${isPillStale ? 'animate-pulse' : ''}`}
                      />
                      {isPillStale && (
                        <div 
                          className={`absolute -top-0.5 -right-0.5 rounded-full border-2 border-background animate-pulse ${isMobile ? 'w-1.5 h-1.5' : 'w-2 h-2'}`}
                          style={{
                            backgroundColor: 'rgb(249 115 22)',
                            boxShadow: '0 0 8px rgb(249 115 22)'
                          }}
                        />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span 
                        className="font-bold tabular-nums block text-left whitespace-nowrap" 
                        style={{ 
                          fontSize: isMobile ? 'min(calc(50cqh * 0.38), calc(100cqw * 0.022))' : 'min(calc(50cqh * 0.42), calc(100cqw * 0.026))',
                          color: linkedPill.battery_level > 50 ? 'rgb(34 197 94)' : linkedPill.battery_level > 20 ? 'rgb(234 179 8)' : 'rgb(239 68 68)' 
                        }}
                      >
                        {linkedPill.battery_level}%
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className={`${isMobile ? 'h-6' : 'h-7'} w-full`} />
                )}
              </div>
              );
            })}
          </div>
          
          <div className="flex flex-col items-center min-w-[14%] gap-0">
            <p className="font-semibold tabular-nums tracking-tight" style={{ fontSize: 'min(calc(42cqh * 0.8), calc(100cqw * 0.026))' }}>
              {currentTime.toLocaleTimeString("sv-SE", {
                hour: "2-digit",
                minute: "2-digit",
              })}:{currentTime.getSeconds().toString().padStart(2, '0')}
            </p>
            <p className="text-muted-foreground/70 uppercase tracking-wider font-semibold -mt-1" style={{ fontSize: 'min(calc(24cqh * 0.9), calc(100cqw * 0.017))' }}>
              {currentTime.toLocaleDateString("sv-SE", {
                weekday: "short",
                day: "numeric",
                month: "short",
              })}
            </p>
          </div>
          
          <div className="relative flex items-center justify-center" style={{ width: 'min(calc(80cqh * 0.85), calc(100cqw * 0.038))', height: 'min(calc(80cqh * 0.85), calc(100cqw * 0.038))' }}>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/settings')}
              className="opacity-40 hover:opacity-100 hover:bg-transparent transition-all duration-300 group w-full h-full"
            >
              <Settings className="transition-all duration-300 group-hover:[fill:hsl(var(--primary))]" style={{ width: '50%', height: '50%' }} />
            </Button>
            <SyncCountdown className="w-full h-full" />
          </div>
        </div>
      </div>

      {/* Main Display Area - All Brews */}
      <div className="flex-1 overflow-hidden relative flex flex-col">
        {isMobile ? (
          // Mobile: Swipeable carousel
          <>
            {/* Pagination dots and swipe indicators */}
            {brews.length > 1 && (
              <div className="relative py-3 flex-shrink-0">
                <div className="flex justify-center gap-2">
                  {brews.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => emblaApi?.scrollTo(index)}
                      className={`h-2 rounded-full transition-all duration-300 ${
                        index === selectedIndex 
                          ? 'w-8 bg-primary' 
                          : 'w-2 bg-muted-foreground/30'
                      }`}
                      aria-label={`Gå till öl ${index + 1}`}
                    />
                  ))}
                </div>
                
                {/* Swipe indicators */}
                {selectedIndex > 0 && (
                  <button
                    onClick={() => emblaApi?.scrollPrev()}
                    className="absolute left-2 top-1/2 -translate-y-1/2 bg-background/80 backdrop-blur-sm p-2 rounded-full border border-primary/20 animate-pulse"
                    aria-label="Föregående öl"
                  >
                    <ChevronLeft className="h-6 w-6 text-primary" />
                  </button>
                )}
                {selectedIndex < brews.length - 1 && (
                  <button
                    onClick={() => emblaApi?.scrollNext()}
                    className="absolute right-2 top-1/2 -translate-y-1/2 bg-background/80 backdrop-blur-sm p-2 rounded-full border border-primary/20 animate-pulse"
                    aria-label="Nästa öl"
                  >
                    <ChevronRight className="h-6 w-6 text-primary" />
                  </button>
                )}
              </div>
            )}
            
            <div className="flex-1 overflow-hidden px-3 py-2" ref={emblaRef}>
              <div className="flex h-full">
                {brews.map((brew) => (
                  <div key={brew.id} className="flex-[0_0_100%] min-w-0 px-3">
                    {renderBrewCard(brew, updatedFields, getTempColor)}
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          // Desktop: Grid layout
          <div className={`grid gap-6 ${getGridLayout()} h-full w-full p-4 py-6`}>
            {brews.map((brew) => renderBrewCard(brew, updatedFields, getTempColor))}
          </div>
        )}
      </div>

      {/* RAPT Controller Settings Dialog */}
      {selectedController && (
        <RaptControllerDialog
          controller={selectedController}
          open={controllerDialogOpen}
          onOpenChange={setControllerDialogOpen}
        />
      )}

      {/* Device Link Dialog */}
      <BrewDeviceLinkDialog
        open={deviceLinkDialog.open}
        onOpenChange={(open) => setDeviceLinkDialog({ ...deviceLinkDialog, open })}
        brewId={deviceLinkDialog.brewId}
        brewName={deviceLinkDialog.brewName}
        currentControllerId={deviceLinkDialog.currentControllerId}
        currentPillId={deviceLinkDialog.currentPillId}
        controllers={raptControllers}
        pills={raptPills}
        onUpdate={loadBrews}
      />
    </div>
  );

  function renderBrewCard(
    brew: BrewData, 
    updatedFields: Record<string, Record<string, boolean>>,
    getTempColor: (temp: number) => { hsl: string; rgb: string }
  ) {
            const hasCardGlow = updatedFields[brew.batch_id]?.cardGlow;
            
            return (
              <Card 
                key={brew.id}
                className={`bg-gradient-card border-border shadow-deep flex flex-col overflow-hidden h-full transition-all duration-1000 ${
                  hasCardGlow ? 'ring-2 ring-primary/50 shadow-[0_0_30px_hsl(var(--primary)/0.4)]' : ''
                }`}
              >
              {/* Header - 10% */}
              <div className="h-[10%] p-2 pb-1 border-b border-border/50 flex-shrink-0" style={{ containerType: 'size' }}>
                <div className="flex items-center justify-between gap-2 h-full">
                  <div className="min-w-0 flex-1">
                    <h2 className="font-bold text-foreground leading-tight truncate" style={{ fontSize: 'min(calc(50cqh * 0.85), calc(100cqw * 0.18))' }}>
                      {brew.name}
                    </h2>
                    <p className="text-muted-foreground truncate" style={{ fontSize: 'min(calc(25cqh * 1.0), calc(100cqw * 0.14))' }}>
                      {brew.style} • {brew.lastUpdate} • {brew.batchNumber}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <BrewEventDialog
                      brewId={brew.id}
                      brewName={brew.name}
                      events={brew.events}
                      onEventsChange={loadBrewEvents}
                    />
                    <span
                      className="rounded-full px-2.5 py-1 font-bold whitespace-nowrap flex-shrink-0"
                      style={{ 
                        fontSize: 'min(calc(30cqh * 1.0), calc(100cqw * 0.16))',
                        backgroundColor: brew.status === "Konditionering" ? "hsl(var(--primary) / 0.2)" : "hsl(var(--ferment-green) / 0.2)",
                        color: brew.status === "Konditionering" ? "hsl(var(--primary))" : "hsl(var(--ferment-green))",
                        animation: brew.status === "Konditionering" ? "none" : "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite"
                      }}
                    >
                      {brew.status === "Jäsning" && brew.sgData.length > 0 ? (
                        (() => {
                          const sortedData = [...brew.sgData].sort((a, b) => 
                            new Date(a.date).getTime() - new Date(b.date).getTime()
                          );
                          const firstDate = new Date(sortedData[0].date);
                          const daysSinceStart = Math.floor(
                            (new Date().getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)
                          );
                          return `${brew.status} dag ${daysSinceStart}`;
                        })()
                      ) : brew.status}
                    </span>
                  </div>
                </div>
              </div>
              
              {/* Chart Area - 58% */}
              <div className="h-[58%] p-2 pb-1 flex-shrink-0">
                <BrewChart 
                  data={brew.sgData} 
                  og={brew.originalGravity} 
                  fg={brew.finalGravity} 
                  singleView={true}
                  events={brew.events}
                />
              </div>

              {/* Stats Grid - 32% */}
              <div className="h-[32%] p-2 pt-1 pb-2 flex-shrink-0">
                <div className="grid grid-cols-3 gap-4 h-full">
                  {/* SG - Large Featured Card */}
                  <div 
                    className={`col-span-1 row-span-2 rounded-lg p-0.5 flex flex-col items-center justify-center gap-0.5 border transition-all duration-1000 relative overflow-hidden ${
                      brew.coldcrashAcknowledged 
                        ? 'bg-green-500/10 border-green-500/30' 
                        : 'bg-background/50 border-primary/20'
                    } ${
                      updatedFields[brew.batch_id]?.sg ? 'shadow-[0_0_20px_hsl(var(--primary)/0.6)] border-primary/60' : ''
                    }`}
                    style={{ containerType: 'size' }}
                  >
                    <p className="text-muted-foreground uppercase tracking-wider flex items-center justify-center z-10 px-1" style={{ fontSize: 'min(calc(18cqh * 0.85), calc(100cqw * 0.15))' }}>Gravity</p>
                    <p className="font-bold text-primary leading-none flex items-center justify-center z-10 px-1 tabular-nums" style={{ fontSize: 'min(calc(35cqh * 0.85), calc(100cqw * 0.26))' }}>
                      {brew.currentSG.toFixed(3)}
                    </p>
                    <div className="text-muted-foreground mt-0.5 space-y-0.5 z-10 text-center px-1 w-full">
                      <p className="tabular-nums truncate" style={{ fontSize: 'min(calc(10cqh * 0.85), calc(100cqw * 0.10))' }}>OG: {brew.originalGravity.toFixed(3)}</p>
                      <p className="tabular-nums truncate" style={{ fontSize: 'min(calc(10cqh * 0.85), calc(100cqw * 0.10))' }}>FG: {brew.finalGravity.toFixed(3)}</p>
                      <p className="font-medium truncate" style={{ fontSize: 'min(calc(10cqh * 0.85), calc(100cqw * 0.10))' }}>
                        {brew.fermentationRate !== null ? (
                          <>{brew.fermentationRate > 0 ? '-' : '+'}{Math.abs(brew.fermentationRate).toFixed(3)}/dygn</>
                        ) : (
                          <>Beräknar...</>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* ABV */}
                  <div 
                    className={`bg-background/50 rounded-lg p-1.5 pr-3 flex flex-col items-start justify-center gap-0 border border-secondary/20 transition-all duration-1000 relative overflow-hidden ${
                      updatedFields[brew.batch_id]?.abv ? 'shadow-[0_0_20px_hsl(var(--secondary)/0.6)] border-secondary/60' : ''
                    }`}
                    style={{ containerType: 'size' }}
                  >
                    <div className="absolute top-1/2 -translate-y-1/2 opacity-20" style={{ width: '60%', height: '60%', right: '-15%' }}>
                      <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
                        <defs>
                          <linearGradient id={`abvFill-${brew.batch_id}`} x1="0" x2="0" y1="0" y2="1">
                            <stop offset="0%" stopColor="hsl(var(--secondary))" stopOpacity="0.1"/>
                            <stop offset={`${100 - Math.min((brew.abv / 10) * 100, 100)}%`} stopColor="hsl(var(--secondary))" stopOpacity="0.1"/>
                            <stop offset={`${100 - Math.min((brew.abv / 10) * 100, 100)}%`} stopColor="hsl(var(--secondary))" stopOpacity="0.8"/>
                            <stop offset="100%" stopColor="hsl(var(--secondary))" stopOpacity="0.8"/>
                          </linearGradient>
                        </defs>
                        {/* Wine glass with fill */}
                        <path d="M8 2l-1 12c0 2 2 4 5 4s5-2 5-4L16 2z" stroke="hsl(var(--secondary))" strokeWidth="1" fill={`url(#abvFill-${brew.batch_id})`}/>
                        <line x1="12" y1="18" x2="12" y2="22" stroke="hsl(var(--secondary))" strokeWidth="1"/>
                        <line x1="9" y1="22" x2="15" y2="22" stroke="hsl(var(--secondary))" strokeWidth="1"/>
                      </svg>
                    </div>
                    <p className="text-muted-foreground uppercase tracking-wider z-10 pl-2" style={{ fontSize: 'min(calc(28cqh * 0.7), calc(100cqw * 0.13))' }}>ABV</p>
                    <p className="font-bold text-secondary leading-none z-10 pl-2" style={{ fontSize: 'min(calc(70cqh * 0.85), calc(100cqw * 0.37))' }}>
                      {brew.abv.toFixed(1)}%
                    </p>
                  </div>

                  {/* Temp */}
                  {(() => {
                    const { pill, controller } = findDevicesForBrew(brew);
                    const tempColor = pill?.color || 'hsl(var(--primary))';
                    
                    return (
                      <div 
                        className={`bg-background/50 rounded-lg p-1.5 pr-3 flex flex-col items-start justify-center gap-0 transition-all duration-1000 relative overflow-hidden cursor-pointer hover:opacity-80`}
                        style={{ 
                          containerType: 'size',
                          borderColor: `${tempColor}33`,
                          borderWidth: '1px',
                          borderStyle: 'solid',
                          ...(updatedFields[brew.batch_id]?.temp && {
                            boxShadow: `0 0 20px ${tempColor}99`,
                            borderColor: `${tempColor}99`
                          })
                        }}
                        onClick={() => {
                          setDeviceLinkDialog({
                            open: true,
                            brewId: brew.batch_id,
                            brewName: brew.name,
                            currentControllerId: brew.linked_controller_id || null,
                            currentPillId: brew.linked_pill_id || null,
                          });
                        }}
                        title="Klicka för att koppla enheter"
                      >
                        <div className="absolute top-1/2 -translate-y-1/2 opacity-20 animate-pulse" style={{ width: '60%', height: '60%', right: '-15%' }}>
                          <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
                            {/* Thermometer outline */}
                            <path 
                              d="M14 4v10a4 4 0 1 1-4 0V4a2 2 0 1 1 4 0Z" 
                              stroke={tempColor}
                              strokeWidth="1" 
                              fill="none"
                            />
                            {/* Thermometer fill - calculate based on 0-30 degrees */}
                            <defs>
                              <clipPath id={`thermo-clip-${brew.batch_id}`}>
                                <path d="M14 4v10a4 4 0 1 1-4 0V4a2 2 0 1 1 4 0Z" />
                              </clipPath>
                            </defs>
                            <rect 
                              x="8" 
                              y={`${24 - (Math.min(Math.max(brew.currentTemp, 0), 30) / 30) * 20}`}
                              width="8" 
                              height="20" 
                              fill={tempColor}
                              clipPath={`url(#thermo-clip-${brew.batch_id})`}
                              className="transition-all duration-500"
                              opacity="0.8"
                            />
                          </svg>
                        </div>
                        <p className="text-muted-foreground uppercase tracking-wider z-10 pl-2" style={{ fontSize: 'min(calc(28cqh * 0.7), calc(100cqw * 0.13))' }}>Temp</p>
                        <p 
                          className="font-bold leading-none z-10 pl-2"
                          style={{ 
                            color: tempColor,
                            fontSize: 'min(calc(70cqh * 0.85), calc(100cqw * 0.37))'
                          }}
                        >
                          {brew.currentTemp}°
                        </p>
                        {controller && controller.target_temp !== null && (
                          <p 
                            className="text-muted-foreground uppercase tracking-wider z-10 pl-2"
                            style={{ fontSize: 'min(calc(28cqh * 0.7), calc(100cqw * 0.13))' }}
                          >
                            Inställ {controller.target_temp.toFixed(0)}°
                          </p>
                        )}
                      </div>
                    );
                  })()}

                  {/* Utjäsning */}
                  <div 
                    className={`bg-background/50 rounded-lg p-1.5 pr-3 flex flex-col items-start justify-center gap-0 border border-ferment-green/20 transition-all duration-1000 relative overflow-hidden ${
                      updatedFields[brew.batch_id]?.attenuation ? 'shadow-[0_0_20px_hsl(var(--ferment-green)/0.6)] border-ferment-green/60' : ''
                    }`}
                    style={{ containerType: 'size' }}
                  >
                    <div className="absolute top-1/2 -translate-y-1/2 opacity-20" style={{ width: '55%', height: '55%', right: '-12%' }}>
                      <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
                        {/* Rising bubbles - colored based on attenuation level */}
                        {/* Bottom bubbles (80-100%) - always active if attenuation > 80 */}
                        <circle cx="14" cy="22" r="1" stroke={brew.attenuation >= 80 ? "hsl(var(--ferment-green))" : "hsl(var(--ferment-green))"} strokeWidth="0.8" fill="none" opacity={brew.attenuation >= 80 ? "0.8" : "0.2"} className="animate-pulse" style={{ animationDelay: '0.4s' }} />
                        <circle cx="8" cy="20" r="1.2" stroke={brew.attenuation >= 80 ? "hsl(var(--ferment-green))" : "hsl(var(--ferment-green))"} strokeWidth="1" fill="none" opacity={brew.attenuation >= 80 ? "0.8" : "0.2"} className="animate-pulse" />
                        <circle cx="18" cy="20" r="1.8" stroke={brew.attenuation >= 70 ? "hsl(var(--ferment-green))" : "hsl(var(--ferment-green))"} strokeWidth="1" fill="none" opacity={brew.attenuation >= 70 ? "0.7" : "0.2"} className="animate-pulse" style={{ animationDelay: '0.5s' }} />
                        
                        {/* Middle bubbles (50-70%) */}
                        <circle cx="8" cy="18" r="2.5" stroke={brew.attenuation >= 60 ? "hsl(var(--ferment-green))" : "hsl(var(--ferment-green))"} strokeWidth="1.5" fill="none" opacity={brew.attenuation >= 60 ? "0.7" : "0.2"} className="animate-pulse" />
                        <circle cx="10" cy="16" r="1.3" stroke={brew.attenuation >= 50 ? "hsl(var(--ferment-green))" : "hsl(var(--ferment-green))"} strokeWidth="1" fill="none" opacity={brew.attenuation >= 50 ? "0.6" : "0.2"} className="animate-pulse" style={{ animationDelay: '0.8s' }} />
                        <circle cx="16" cy="14" r="3" stroke={brew.attenuation >= 40 ? "hsl(var(--ferment-green))" : "hsl(var(--ferment-green))"} strokeWidth="1.5" fill="none" opacity={brew.attenuation >= 40 ? "0.6" : "0.2"} className="animate-pulse" style={{ animationDelay: '0.3s' }} />
                        
                        {/* Upper-middle bubbles (30-40%) */}
                        <circle cx="6" cy="12" r="1.5" stroke={brew.attenuation >= 30 ? "hsl(var(--ferment-green))" : "hsl(var(--ferment-green))"} strokeWidth="1" fill="none" opacity={brew.attenuation >= 30 ? "0.5" : "0.2"} className="animate-pulse" style={{ animationDelay: '0.2s' }} />
                        <circle cx="16" cy="10" r="0.8" stroke={brew.attenuation >= 20 ? "hsl(var(--ferment-green))" : "hsl(var(--ferment-green))"} strokeWidth="0.8" fill="none" opacity={brew.attenuation >= 20 ? "0.4" : "0.2"} className="animate-pulse" style={{ animationDelay: '0.1s' }} />
                        
                        {/* Top bubbles (10-20%) */}
                        <circle cx="12" cy="8" r="2" stroke={brew.attenuation >= 10 ? "hsl(var(--ferment-green))" : "hsl(var(--ferment-green))"} strokeWidth="1.5" fill="none" opacity={brew.attenuation >= 10 ? "0.4" : "0.2"} className="animate-pulse" style={{ animationDelay: '0.6s' }} />
                        <circle cx="9" cy="6" r="1.2" stroke={brew.attenuation >= 5 ? "hsl(var(--ferment-green))" : "hsl(var(--ferment-green))"} strokeWidth="0.8" fill="none" opacity={brew.attenuation >= 5 ? "0.3" : "0.2"} className="animate-pulse" style={{ animationDelay: '0.7s' }} />
                      </svg>
                    </div>
                    <p className="text-muted-foreground uppercase tracking-wider z-10 pl-2" style={{ fontSize: 'min(calc(28cqh * 0.7), calc(100cqw * 0.13))' }}>Utjäsning</p>
                    <p className="font-bold text-ferment-green leading-none z-10 pl-2" style={{ fontSize: 'min(calc(70cqh * 0.85), calc(100cqw * 0.37))' }}>
                      {brew.attenuation}%
                    </p>
                  </div>

                  {/* Batteri */}
                  <div 
                    className={`bg-background/50 rounded-lg p-1.5 pr-3 flex flex-col items-start justify-center gap-0 border border-primary/20 transition-all duration-1000 relative overflow-hidden ${
                      updatedFields[brew.batch_id]?.battery ? 'shadow-[0_0_20px_hsl(var(--primary)/0.6)] border-primary/60' : ''
                    }`}
                    style={{ containerType: 'size' }}
                  >
                    <div className="absolute top-1/2 -translate-y-1/2 opacity-20" style={{ width: '55%', height: '55%', right: '-12%' }}>
                      <svg viewBox="0 0 24 24" fill="none" className="w-full h-full" style={{ transform: 'rotate(-90deg)' }}>
                        {/* Battery outline */}
                        <rect x="2" y="6" width="18" height="12" rx="2" stroke="hsl(var(--primary))" strokeWidth="1" fill="none"/>
                        <path d="M22 9v6" stroke="hsl(var(--primary))" strokeWidth="1" strokeLinecap="round"/>
                        {/* Battery fill */}
                        {brew.battery !== null && (
                          <rect 
                            x="4" 
                            y="8" 
                            width={`${(brew.battery / 100) * 14}`} 
                            height="8" 
                            rx="1" 
                            fill="hsl(var(--primary))"
                            className="transition-all duration-500"
                            opacity="0.8"
                          />
                        )}
                      </svg>
                    </div>
                    <p className="text-muted-foreground uppercase tracking-wider z-10 pl-2" style={{ fontSize: 'min(calc(28cqh * 0.7), calc(100cqw * 0.13))' }}>Batteri</p>
                    <p className="font-bold text-primary leading-none z-10 pl-2" style={{ fontSize: 'min(calc(70cqh * 0.85), calc(100cqw * 0.37))' }}>
                      {brew.battery !== null ? `${brew.battery}%` : "N/A"}
                    </p>
                  </div>
                </div>
              </div>
            </Card>
    );
  }
}
