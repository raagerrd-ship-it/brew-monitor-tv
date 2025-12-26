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
import { useNavigate, useSearchParams } from "react-router-dom";
import { Settings, Loader2, Droplets, Thermometer, TrendingDown, Wine, Beer, Battery, ChevronLeft, ChevronRight, Pill, AirVent, Share2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { toast as sonnerToast } from "sonner";
import useEmblaCarousel from "embla-carousel-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useVersionCheck } from "@/hooks/use-version-check";

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
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: false, align: "center" });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [raptControllers, setRaptControllers] = useState<TempController[]>([]);
  const [raptPills, setRaptPills] = useState<PillData[]>([]);
  const [searchParams] = useSearchParams();
  const focusedBrewId = searchParams.get('brew');
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

  // Check for new app versions every 60 seconds
  useVersionCheck(60000);

  useEffect(() => {
    loadBrews();
    loadRaptData();
    
    // Check authentication status
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsAuthenticated(!!session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setIsAuthenticated(!!session);
    });

    return () => subscription.unsubscribe();
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

  // Scroll to focused brew when URL param is present
  useEffect(() => {
    if (!focusedBrewId || !emblaApi || brews.length === 0) return;
    
    // Try to find brew by batch_id first, then by name slug
    let brewIndex = brews.findIndex(b => b.batch_id === focusedBrewId);
    
    // If not found by batch_id, try to match by name slug
    if (brewIndex === -1) {
      brewIndex = brews.findIndex(b => {
        const brewSlug = b.name.toLowerCase().replace(/[åä]/g, 'a').replace(/ö/g, 'o').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        return brewSlug === focusedBrewId;
      });
    }
    
    if (brewIndex !== -1) {
      emblaApi.scrollTo(brewIndex);
      
      // Show a subtle indication that this brew is focused
      sonnerToast(`${brews[brewIndex].name} är i fokus`, {
        description: "Detta öl delades med dig",
        duration: 3000,
      });
    }
  }, [focusedBrewId, emblaApi, brews]);

  const handleShareBrew = async (brew: BrewData) => {
    // Create URL-friendly slug from brew name
    const brewSlug = brew.name.toLowerCase().replace(/[åä]/g, 'a').replace(/ö/g, 'o').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const shareUrl = `https://brew-monitor-tv.lovable.app/?brew=${brewSlug}`;
    
    try {
      await navigator.clipboard.writeText(shareUrl);
      sonnerToast(`${brew.name} delad!`, {
        description: "Länken har kopierats till urklipp",
        duration: 3000,
      });
    } catch (error) {
      console.error('Failed to copy:', error);
      toast({
        title: "Kunde inte kopiera länk",
        description: "Försök igen",
        variant: "destructive",
      });
    }
  };

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
                    status: updatedReading.status ?? brew.status,
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
                    // For Conditioning or Completed status, show 0 rate (pill is likely removed)
                    fermentationRate: ((updatedReading.status ?? brew.status) === 'Conditioning' || (updatedReading.status ?? brew.status) === 'Completed') ? 0 : newFermentationRate,
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
          console.log('Selected RAPT pills changed, reloading...');
          sonnerToast('Inställningar uppdaterade', {
            description: 'RAPT Pill-listan har ändrats från en annan enhet',
            duration: 5000,
          });
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
          console.log('Selected RAPT controllers changed, reloading...');
          sonnerToast('Inställningar uppdaterade', {
            description: 'RAPT-kontrollerlistan har ändrats från en annan enhet',
            duration: 5000,
          });
          loadRaptData();
        }
      )
      .subscribe();

    // Set up realtime for selected brews (visibility changes from Settings)
    const selectedBrewsChannel = supabase
      .channel('selected_brews_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'selected_brews'
        },
        () => {
          console.log('Selected brews changed, reloading...');
          sonnerToast('Inställningar uppdaterade', {
            description: 'Öllistan har ändrats från en annan enhet',
            duration: 5000,
          });
          loadBrews();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(brewChannel);
      supabase.removeChannel(pillsChannel);
      supabase.removeChannel(controllersChannel);
      supabase.removeChannel(selectedPillsChannel);
      supabase.removeChannel(selectedControllersChannel);
      supabase.removeChannel(selectedBrewsChannel);
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
          // For Conditioning or Completed status, show 0 rate (pill is likely removed)
          fermentationRate: (reading.status === 'Conditioning' || reading.status === 'Completed') ? 0 : fermentationRate,
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

  // No early return - show header even when no brews are selected

  // Dynamic grid layout based on number of brews
  // All layouts use flex with fixed card widths matching 2-brew proportions
  const getGridLayout = () => {
    const count = brews.length;
    if (count === 3) return "flex justify-center gap-6"; // 3 cards in a row
    return "flex flex-wrap justify-center gap-6";
  };
  
  // Get card width class - locks cards to 2-brew proportions
  const getCardWidthClass = () => {
    const count = brews.length;
    // flex-1 with min-w-0 ensures equal width regardless of content
    if (count === 3) return "flex-1 min-w-0"; // Equal distribution, prevent content from affecting width
    return "w-[calc(50%-0.75rem)]"; // Fixed width matching 2-brew layout
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
      {/* Header Bar - Clean Modern Design */}
      <div 
        className="h-[11%] flex items-center justify-between flex-shrink-0 overflow-visible px-6 gap-6 relative"
        style={{ 
          containerType: 'size',
          background: 'linear-gradient(180deg, hsl(222 18% 12%) 0%, hsl(222 20% 9%) 100%)',
          borderBottom: '1px solid hsl(222 15% 16%)',
        }}
      >
        {/* Subtle top highlight */}
        <div 
          className="absolute inset-x-0 top-0 h-px"
          style={{ background: 'linear-gradient(90deg, transparent 0%, hsl(222 15% 25%) 20%, hsl(222 15% 25%) 80%, transparent 100%)' }}
        />
        <div className="relative flex items-center">
          {isMobile ? (
            <div className="relative inline-block">
              <Beer 
                className="h-8 w-8" 
                style={{ 
                  color: 'hsl(38 90% 60%)',
                }}
              />
            </div>
          ) : (
            <h1 
              className="font-bold leading-relaxed tracking-tight" 
              style={{ 
                fontSize: 'min(7vh, 3vw)',
                background: 'linear-gradient(135deg, hsl(38 90% 60%) 0%, hsl(45 95% 65%) 100%)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              Bryggövervakare
            </h1>
          )}
        </div>
        
        {/* RAPT Section */}
        <div className={`flex items-center ${isMobile ? 'gap-2 flex-1 overflow-hidden' : 'gap-4'}`}>
          {/* Grouped RAPT container */}
          {raptControllers.length > 0 && (
            <div 
              className={`flex items-center rounded-lg ${isMobile ? 'gap-1 px-1.5 py-1 flex-1 overflow-x-auto scrollbar-hide' : 'gap-1.5 px-2 py-1.5'}`}
              style={{
                background: 'hsl(222 20% 11%)',
                border: '1px solid hsl(222 15% 18%)',
                boxShadow: '0 6px 20px hsl(222 30% 3% / 0.6), 0 3px 8px hsl(222 30% 3% / 0.4), inset 0 1px 0 hsl(0 0% 100% / 0.04)',
              }}
            >
              {raptControllers.map((controller, index) => {
                const controllerColor = getControllerColor(controller.name);
                
                // Find the pill that belongs to this controller
                const linkedPill = raptPills.find(p => p.pill_id === controller.linked_pill_id);
                const isPillStale = linkedPill?.last_update ? 
                  ((new Date().getTime() - new Date(linkedPill.last_update).getTime()) / (1000 * 60 * 60)) > 24 
                  : true;
                
                return (
                  <div key={controller.id} className="flex items-center">
                    {/* Separator between cards */}
                    {index > 0 && (
                      <div 
                        className={`${isMobile ? 'h-6 mx-1' : 'h-8 mx-1.5'} w-px`}
                        style={{ background: 'hsl(222 15% 20%)' }}
                      />
                    )}
                    
                    <div 
                      className={`flex items-center cursor-pointer flex-shrink-0 transition-all duration-200 rounded ${isMobile ? 'px-2 py-1 gap-2' : 'px-2.5 py-1.5 gap-2.5'}`}
                      style={{ background: 'transparent' }}
                      onClick={() => {
                        setSelectedController(controller);
                        setControllerDialogOpen(true);
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'hsl(222 18% 15%)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                      }}
                      title={`${controller.name}\n${controller.pill_temp !== null ? `Pill: ${controller.pill_temp.toFixed(1)}°C` : `Inbyggd: ${controller.current_temp !== null ? controller.current_temp.toFixed(1) : '--'}°C`}\nMål: ${controller.target_temp !== null ? controller.target_temp.toFixed(1) : '--'}°C\n\nKlicka för att ändra inställningar`}
                    >
                      {/* Controller icon */}
                      <AirVent 
                        style={{
                          width: isMobile ? '1rem' : '1.1rem',
                          height: isMobile ? '1rem' : '1.1rem',
                          color: controllerColor,
                          flexShrink: 0,
                          opacity: 0.7,
                        }}
                      />
                      
                      {/* Temperature */}
                      <span 
                        className={`font-semibold tabular-nums whitespace-nowrap ${isMobile ? 'text-sm' : ''}`}
                        style={{
                          fontSize: isMobile ? undefined : 'min(2.6vh, 1.5vw)',
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
                      
                      {/* Pill battery indicator - compact */}
                      {linkedPill && (
                        <div 
                          className={`flex items-center gap-1 transition-opacity ${isPillStale ? 'opacity-40' : 'opacity-60'}`}
                          title={`${linkedPill.name}\nBatteri: ${linkedPill.battery_level}%${isPillStale ? '\n⚠️ Ingen uppdatering på >24h' : ''}`}
                        >
                          <div className="relative flex items-center">
                            <Pill
                              style={{
                                width: isMobile ? '0.7rem' : '0.85rem',
                                height: isMobile ? '0.7rem' : '0.85rem',
                                flexShrink: 0,
                              }}
                              color={linkedPill.color}
                              strokeWidth={2}
                              className={isPillStale ? 'animate-pulse' : ''}
                            />
                            {isPillStale && (
                              <div 
                                className="absolute -top-0.5 -right-0.5 rounded-full w-1.5 h-1.5"
                                style={{ backgroundColor: 'hsl(25 95% 53%)' }}
                              />
                            )}
                          </div>
                          <span 
                            className={`tabular-nums whitespace-nowrap ${isMobile ? 'text-[10px]' : 'text-xs'}`}
                            style={{ color: linkedPill.color }}
                          >
                            {linkedPill.battery_level}%
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          
          {/* Clock Section */}
          {!isMobile && (
            <div className="flex flex-col items-end justify-center">
              <p 
                className="font-semibold tabular-nums tracking-tight text-foreground"
                style={{ 
                  fontSize: 'min(4.5vh, 2.2vw)',
                  fontVariantNumeric: 'tabular-nums',
                  lineHeight: 1.1,
                }}
              >
                {currentTime.toLocaleTimeString("sv-SE", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                <span className="text-muted-foreground/40">:</span>
                <span className="text-muted-foreground/60">{currentTime.getSeconds().toString().padStart(2, '0')}</span>
              </p>
              <p 
                className="text-muted-foreground/50 uppercase tracking-wider font-medium" 
                style={{ fontSize: 'min(2vh, 1.1vw)' }}
              >
                {currentTime.toLocaleDateString("sv-SE", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                })}
              </p>
            </div>
          )}
          
          {/* Settings Button */}
          <div 
            className="relative flex items-center justify-center" 
            style={{ 
              width: 'min(6vh, 3.8vw)', 
              height: 'min(6vh, 3.8vw)',
            }}
          >
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/settings')}
              className="opacity-40 hover:opacity-100 hover:bg-transparent transition-opacity duration-200 w-full h-full rounded-full"
            >
              <Settings 
                className="transition-colors duration-200" 
                style={{ width: '50%', height: '50%' }} 
              />
            </Button>
            <SyncCountdown className="w-full h-full" />
          </div>
        </div>
      </div>

      {/* Main Display Area - All Brews */}
      <div className="flex-1 overflow-hidden relative flex flex-col">
        {brews.length === 0 ? (
          // No brews selected - show message
          <div className="flex items-center justify-center h-full p-4">
            <Card className="max-w-2xl w-full p-8 text-center">
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
        ) : isMobile ? (
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
          // Desktop: Grid/Flex layout
          <div className={`${getGridLayout()} h-full w-full p-4 py-6`}>
            {brews.map((brew) => (
              <div key={brew.id} className={getCardWidthClass()}>
                {renderBrewCard(brew, updatedFields, getTempColor)}
              </div>
            ))}
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
                className={`border-white/15 shadow-deep flex flex-col overflow-hidden h-full relative backdrop-blur-xl ${
                  isAuthenticated ? 'group' : ''
                } ${
                  hasCardGlow ? 'ring-2 ring-primary/50 shadow-[0_0_30px_hsl(var(--primary)/0.4)]' : ''
                }`}
                style={{
                  background: 'linear-gradient(180deg, hsl(222 18% 18% / 0.65) 0%, hsl(222 20% 12% / 0.75) 100%)',
                  boxShadow: hasCardGlow 
                    ? undefined 
                    : '0 8px 32px hsl(222 30% 5% / 0.6), inset 0 1px 0 hsl(0 0% 100% / 0.12), inset 0 -1px 0 hsl(0 0% 0% / 0.2)',
                }}
              >
              {/* Glass highlight overlay - top edge */}
              <div 
                className="absolute inset-x-0 top-0 h-[1px] pointer-events-none z-10"
                style={{
                  background: 'linear-gradient(90deg, transparent 10%, hsl(0 0% 100% / 0.08) 30%, hsl(0 0% 100% / 0.12) 50%, hsl(0 0% 100% / 0.08) 70%, transparent 90%)'
                }}
              />
              {/* Header - 10% */}
              <div className="h-[10%] px-3 py-2 flex-shrink-0 relative" style={{ containerType: 'size' }}>
                {/* Gradient header border */}
                <div 
                  className="absolute bottom-0 left-0 right-0 h-[1px]"
                  style={{
                    background: 'linear-gradient(90deg, transparent 5%, hsl(var(--border) / 0.5) 25%, hsl(var(--border) / 0.6) 50%, hsl(var(--border) / 0.5) 75%, transparent 95%)'
                  }}
                />
                <div className="flex items-center justify-between gap-2 h-full">
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <h2 
                      className="font-bold text-foreground leading-tight truncate tracking-tight"
                      style={{ 
                        fontSize: 'min(2.8vh, 2.6vw)',
                        textShadow: '0 2px 8px hsl(0 0% 0% / 0.4)',
                        letterSpacing: '-0.02em'
                      }}
                    >
                      {brew.name}
                    </h2>
                    <p 
                      className="text-muted-foreground/60 truncate font-medium" 
                      style={{ fontSize: 'min(1.3vh, 1.5vw)', letterSpacing: '0.02em' }}
                    >
                      {brew.style && brew.style !== "Okänd stil" ? `${brew.style} • ` : ""}{brew.lastUpdate} • {brew.batchNumber}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {/* Action buttons - only visible when authenticated */}
                    {isAuthenticated && (
                      <div className="flex items-center gap-1 max-w-0 group-hover:max-w-[80px] overflow-hidden transition-all duration-200">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleShareBrew(brew)}
                          className="h-7 w-7 hover:bg-primary/10 text-muted-foreground hover:text-foreground flex-shrink-0"
                          title="Dela detta öl"
                        >
                          <Share2 className="h-3.5 w-3.5" />
                        </Button>
                        <BrewEventDialog
                          brewId={brew.id}
                          brewName={brew.name}
                          events={brew.events}
                          onEventsChange={loadBrewEvents}
                        />
                      </div>
                    )}
                    {/* Status badge - glassmorphism style */}
                    <span
                      className="rounded-full px-2.5 py-1 font-semibold whitespace-nowrap flex-shrink-0 backdrop-blur-md"
                      style={{ 
                        fontSize: 'min(1.6vh, 1.8vw)',
                        background: (brew.status === "Konditionering" || brew.status === "Klar") 
                          ? "linear-gradient(135deg, hsl(var(--primary) / 0.25) 0%, hsl(var(--primary) / 0.1) 100%)" 
                          : "linear-gradient(135deg, hsl(var(--ferment-green) / 0.25) 0%, hsl(var(--ferment-green) / 0.1) 100%)",
                        color: (brew.status === "Konditionering" || brew.status === "Klar") ? "hsl(var(--primary))" : "hsl(var(--ferment-green))",
                        border: (brew.status === "Konditionering" || brew.status === "Klar")
                          ? "1px solid hsl(var(--primary) / 0.3)" 
                          : "1px solid hsl(var(--ferment-green) / 0.4)",
                        boxShadow: (brew.status === "Konditionering" || brew.status === "Klar") 
                          ? "inset 0 1px 0 hsl(0 0% 100% / 0.1), inset 0 -1px 0 hsl(0 0% 0% / 0.05)" 
                          : "0 0 20px hsl(var(--ferment-green) / 0.35), inset 0 1px 0 hsl(0 0% 100% / 0.15), inset 0 -1px 0 hsl(0 0% 0% / 0.1)",
                        textShadow: (brew.status === "Konditionering" || brew.status === "Klar") 
                          ? "none" 
                          : "0 0 10px hsl(var(--ferment-green) / 0.5)"
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
                <div className="grid grid-cols-3 gap-3 h-full">
                  {/* SG - Large Featured Card */}
                  <div 
                    className={`col-span-1 row-span-2 rounded-xl p-1 flex flex-col items-center justify-center gap-0.5 transition-all duration-1000 relative overflow-hidden ${
                      brew.coldcrashAcknowledged 
                        ? 'bg-green-500/10 border border-green-500/30' 
                        : 'backdrop-blur-sm border border-primary/20'
                    } ${
                      updatedFields[brew.batch_id]?.sg ? 'shadow-[0_0_25px_hsl(var(--primary)/0.5)] border-primary/50' : ''
                    }`}
                    style={{ 
                      containerType: 'size',
                      background: brew.coldcrashAcknowledged 
                        ? 'linear-gradient(135deg, hsl(120 50% 20% / 0.15) 0%, hsl(120 40% 15% / 0.1) 100%)'
                        : 'linear-gradient(135deg, hsl(38 90% 60% / 0.08) 0%, hsl(222 18% 15% / 0.6) 100%)',
                      boxShadow: updatedFields[brew.batch_id]?.sg 
                        ? undefined 
                        : '0 6px 20px hsl(222 30% 3% / 0.6), 0 3px 8px hsl(222 30% 3% / 0.4), inset 0 1px 0 hsl(0 0% 100% / 0.06)'
                    }}
                  >
                    <p className="text-muted-foreground/60 tracking-wide flex items-center justify-center z-10 px-1 font-normal" style={{ fontSize: 'min(2.8vh, 1.5vw)' }}>Gravity</p>
                    <p 
                      className={`font-bold text-primary leading-none flex items-center justify-center z-10 px-1 tabular-nums ${updatedFields[brew.batch_id]?.sg ? 'animate-value-shimmer' : ''}`}
                      style={{ 
                        fontSize: 'min(6vh, 3vw)',
                        textShadow: '0 0 20px hsl(var(--primary) / 0.4)'
                      }}
                    >
                      {brew.currentSG.toFixed(3)}
                    </p>
                    <div className="text-muted-foreground/70 mt-0.5 space-y-0.5 z-10 text-center px-1 w-full">
                      <p className="tabular-nums truncate" style={{ fontSize: 'min(1.8vh, 1.1vw)' }}>OG: {brew.originalGravity.toFixed(3)}</p>
                      <p className="tabular-nums truncate" style={{ fontSize: 'min(1.8vh, 1.1vw)' }}>FG: {brew.finalGravity.toFixed(3)}</p>
                      <p className="font-medium truncate" style={{ fontSize: 'min(1.8vh, 1.1vw)' }}>
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
                    className={`rounded-xl p-1.5 pr-3 flex flex-col items-start justify-center gap-0 backdrop-blur-sm border border-secondary/20 transition-all duration-1000 relative overflow-hidden ${
                      updatedFields[brew.batch_id]?.abv ? 'shadow-[0_0_25px_hsl(var(--secondary)/0.5)] border-secondary/50' : ''
                    }`}
                    style={{ 
                      containerType: 'size',
                      background: 'linear-gradient(135deg, hsl(45 80% 55% / 0.06) 0%, hsl(222 18% 15% / 0.5) 100%)',
                      boxShadow: updatedFields[brew.batch_id]?.abv 
                        ? undefined 
                        : '0 6px 20px hsl(222 30% 3% / 0.6), 0 3px 8px hsl(222 30% 3% / 0.4), inset 0 1px 0 hsl(0 0% 100% / 0.06)'
                    }}
                  >
                    <div className="absolute top-1/2 -translate-y-1/2 opacity-10" style={{ width: '60%', height: '60%', right: '-15%' }}>
                      <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
                        <defs>
                          <linearGradient id={`abvFill-${brew.batch_id}`} x1="0" x2="0" y1="0" y2="1">
                            <stop offset="0%" stopColor="hsl(var(--secondary))" stopOpacity="0.05"/>
                            <stop offset={`${100 - Math.min((brew.abv / 10) * 100, 100)}%`} stopColor="hsl(var(--secondary))" stopOpacity="0.05"/>
                            <stop offset={`${100 - Math.min((brew.abv / 10) * 100, 100)}%`} stopColor="hsl(var(--secondary))" stopOpacity="0.6"/>
                            <stop offset="100%" stopColor="hsl(var(--secondary))" stopOpacity="0.6"/>
                          </linearGradient>
                        </defs>
                        {/* Wine glass with fill - thinner strokes */}
                        <path d="M8 2l-1 12c0 2 2 4 5 4s5-2 5-4L16 2z" stroke="hsl(var(--secondary))" strokeWidth="0.75" fill={`url(#abvFill-${brew.batch_id})`}/>
                        <line x1="12" y1="18" x2="12" y2="22" stroke="hsl(var(--secondary))" strokeWidth="0.75"/>
                        <line x1="9" y1="22" x2="15" y2="22" stroke="hsl(var(--secondary))" strokeWidth="0.75"/>
                      </svg>
                    </div>
                    <p className="text-muted-foreground/60 tracking-wide z-10 pl-2 font-normal" style={{ fontSize: 'min(1.8vh, 1vw)' }}>Abv</p>
                    <p 
                      className={`font-bold text-secondary leading-none z-10 pl-2 ${updatedFields[brew.batch_id]?.abv ? 'animate-value-shimmer' : ''}`}
                      style={{ 
                        fontSize: 'min(5.5vh, 2.5vw)',
                        textShadow: '0 0 15px hsl(var(--secondary) / 0.3)'
                      }}
                    >
                      {brew.abv.toFixed(1)}%
                    </p>
                  </div>

                  {/* Temp */}
                  {(() => {
                    const { pill, controller } = findDevicesForBrew(brew);
                    const tempColor = pill?.color || 'hsl(var(--primary))';
                    
                    const isInactive = brew.status === "Konditionering" || brew.status === "Klar";
                    
                    return (
                      <div 
                        className={`rounded-xl p-1.5 pr-3 flex flex-col items-start justify-center gap-0 relative overflow-hidden backdrop-blur-sm ${isAuthenticated ? 'cursor-pointer hover:opacity-80' : ''} ${isInactive ? 'opacity-40' : ''}`}
                        style={{ 
                          containerType: 'size',
                          borderColor: `${tempColor}33`,
                          borderWidth: '1px',
                          borderStyle: 'solid',
                          background: `linear-gradient(135deg, ${tempColor}08 0%, hsl(222 18% 15% / 0.5) 100%)`,
                          boxShadow: updatedFields[brew.batch_id]?.temp 
                            ? `0 0 25px ${tempColor}66`
                            : '0 6px 20px hsl(222 30% 3% / 0.6), 0 3px 8px hsl(222 30% 3% / 0.4), inset 0 1px 0 hsl(0 0% 100% / 0.06)',
                          ...(updatedFields[brew.batch_id]?.temp && {
                            borderColor: `${tempColor}66`
                          })
                        }}
                        onClick={() => {
                          if (isAuthenticated) {
                            setDeviceLinkDialog({
                              open: true,
                              brewId: brew.batch_id,
                              brewName: brew.name,
                              currentControllerId: brew.linked_controller_id || null,
                              currentPillId: brew.linked_pill_id || null,
                            });
                          }
                        }}
                        title={isAuthenticated ? "Klicka för att koppla enheter" : undefined}
                      >
                        <div className="absolute top-1/2 -translate-y-1/2 opacity-10" style={{ width: '60%', height: '60%', right: '-15%' }}>
                          <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
                            {/* Thermometer outline - thinner stroke */}
                            <path 
                              d="M14 4v10a4 4 0 1 1-4 0V4a2 2 0 1 1 4 0Z" 
                              stroke={tempColor}
                              strokeWidth="0.75" 
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
                              opacity="0.6"
                            />
                          </svg>
                        </div>
                        <p className="text-muted-foreground/60 tracking-wide z-10 pl-2 font-normal" style={{ fontSize: 'min(1.8vh, 1vw)' }}>
                          Temp{controller && controller.target_temp !== null && ` (${controller.target_temp.toFixed(0)}°)`}
                        </p>
                        <p 
                          className={`font-bold leading-none z-10 pl-2 ${updatedFields[brew.batch_id]?.temp ? 'animate-value-shimmer' : ''}`}
                          style={{ 
                            color: tempColor,
                            fontSize: 'min(5.5vh, 2.5vw)',
                            textShadow: `0 0 15px ${tempColor}40`
                          }}
                        >
                          {brew.currentTemp}°
                        </p>
                      </div>
                    );
                  })()}

                  {/* Utjäsning */}
                  <div 
                    className={`rounded-xl p-1.5 pr-3 flex flex-col items-start justify-center gap-0 backdrop-blur-sm border border-ferment-green/20 transition-all duration-1000 relative overflow-hidden ${
                      updatedFields[brew.batch_id]?.attenuation ? 'shadow-[0_0_25px_hsl(var(--ferment-green)/0.5)] border-ferment-green/50' : ''
                    }`}
                    style={{ 
                      containerType: 'size',
                      background: 'linear-gradient(135deg, hsl(120 50% 45% / 0.06) 0%, hsl(222 18% 15% / 0.5) 100%)',
                      boxShadow: updatedFields[brew.batch_id]?.attenuation 
                        ? undefined 
                        : '0 6px 20px hsl(222 30% 3% / 0.6), 0 3px 8px hsl(222 30% 3% / 0.4), inset 0 1px 0 hsl(0 0% 100% / 0.06)'
                    }}
                  >
                    {(() => {
                      const isInactiveAttenuation = brew.status === "Konditionering" || brew.status === "Klar";
                      return (
                        <div className="absolute top-1/2 -translate-y-1/2 opacity-10" style={{ width: '55%', height: '55%', right: '-12%' }}>
                          <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
                            {/* Rising bubbles - thinner strokes, gradient opacity */}
                            <circle cx="14" cy="22" r="1" stroke="hsl(var(--ferment-green))" strokeWidth="0.5" fill="none" opacity={brew.attenuation >= 80 ? "0.7" : "0.15"} className={isInactiveAttenuation ? '' : 'animate-pulse'} style={{ animationDelay: '0.4s' }} />
                            <circle cx="8" cy="20" r="1.2" stroke="hsl(var(--ferment-green))" strokeWidth="0.6" fill="none" opacity={brew.attenuation >= 80 ? "0.7" : "0.15"} className={isInactiveAttenuation ? '' : 'animate-pulse'} />
                            <circle cx="18" cy="20" r="1.8" stroke="hsl(var(--ferment-green))" strokeWidth="0.6" fill="none" opacity={brew.attenuation >= 70 ? "0.6" : "0.15"} className={isInactiveAttenuation ? '' : 'animate-pulse'} style={{ animationDelay: '0.5s' }} />
                            <circle cx="8" cy="18" r="2.5" stroke="hsl(var(--ferment-green))" strokeWidth="0.75" fill="none" opacity={brew.attenuation >= 60 ? "0.6" : "0.15"} className={isInactiveAttenuation ? '' : 'animate-pulse'} />
                            <circle cx="10" cy="16" r="1.3" stroke="hsl(var(--ferment-green))" strokeWidth="0.6" fill="none" opacity={brew.attenuation >= 50 ? "0.5" : "0.15"} className={isInactiveAttenuation ? '' : 'animate-pulse'} style={{ animationDelay: '0.8s' }} />
                            <circle cx="16" cy="14" r="3" stroke="hsl(var(--ferment-green))" strokeWidth="0.75" fill="none" opacity={brew.attenuation >= 40 ? "0.5" : "0.15"} className={isInactiveAttenuation ? '' : 'animate-pulse'} style={{ animationDelay: '0.3s' }} />
                            <circle cx="6" cy="12" r="1.5" stroke="hsl(var(--ferment-green))" strokeWidth="0.6" fill="none" opacity={brew.attenuation >= 30 ? "0.4" : "0.15"} className={isInactiveAttenuation ? '' : 'animate-pulse'} style={{ animationDelay: '0.2s' }} />
                            <circle cx="16" cy="10" r="0.8" stroke="hsl(var(--ferment-green))" strokeWidth="0.5" fill="none" opacity={brew.attenuation >= 20 ? "0.35" : "0.15"} className={isInactiveAttenuation ? '' : 'animate-pulse'} style={{ animationDelay: '0.1s' }} />
                            <circle cx="12" cy="8" r="2" stroke="hsl(var(--ferment-green))" strokeWidth="0.75" fill="none" opacity={brew.attenuation >= 10 ? "0.35" : "0.15"} className={isInactiveAttenuation ? '' : 'animate-pulse'} style={{ animationDelay: '0.6s' }} />
                            <circle cx="9" cy="6" r="1.2" stroke="hsl(var(--ferment-green))" strokeWidth="0.5" fill="none" opacity={brew.attenuation >= 5 ? "0.3" : "0.15"} className={isInactiveAttenuation ? '' : 'animate-pulse'} style={{ animationDelay: '0.7s' }} />
                          </svg>
                        </div>
                      );
                    })()}
                    <p className="text-muted-foreground/60 tracking-wide z-10 pl-2 font-normal" style={{ fontSize: 'min(1.8vh, 1vw)' }}>Utjäsning</p>
                    <p 
                      className={`font-bold text-ferment-green leading-none z-10 pl-2 ${updatedFields[brew.batch_id]?.attenuation ? 'animate-value-shimmer' : ''}`}
                      style={{ 
                        fontSize: 'min(5.5vh, 2.5vw)',
                        textShadow: '0 0 15px hsl(var(--ferment-green) / 0.3)'
                      }}
                    >
                      {brew.attenuation}%
                    </p>
                  </div>

                  {/* Batteri */}
                  {(() => {
                    const { pill } = findDevicesForBrew(brew);
                    const batteryColor = pill?.color || 'hsl(var(--primary))';
                    const isInactive = brew.status === "Konditionering" || brew.status === "Klar";
                    
                    return (
                      <div 
                        className={`rounded-xl p-1.5 pr-3 flex flex-col items-start justify-center gap-0 relative overflow-hidden backdrop-blur-sm ${isInactive ? 'opacity-40' : ''}`}
                        style={{ 
                          containerType: 'size',
                          borderColor: `${batteryColor}33`,
                          borderWidth: '1px',
                          borderStyle: 'solid',
                          background: `linear-gradient(135deg, ${batteryColor}05 0%, hsl(222 18% 15% / 0.5) 100%)`,
                          boxShadow: updatedFields[brew.batch_id]?.battery 
                            ? `0 0 25px ${batteryColor}66` 
                            : '0 6px 20px hsl(222 30% 3% / 0.6), 0 3px 8px hsl(222 30% 3% / 0.4), inset 0 1px 0 hsl(0 0% 100% / 0.06)'
                        }}
                      >
                        <div className="absolute top-1/2 -translate-y-1/2 opacity-10" style={{ width: '55%', height: '55%', right: '-12%' }}>
                          <svg viewBox="0 0 24 24" fill="none" className="w-full h-full" style={{ transform: 'rotate(-90deg)' }}>
                            {/* Battery outline - thinner stroke */}
                            <rect x="2" y="6" width="18" height="12" rx="2" stroke={batteryColor} strokeWidth="0.75" fill="none"/>
                            <path d="M22 9v6" stroke={batteryColor} strokeWidth="0.75" strokeLinecap="round"/>
                            {/* Battery fill */}
                            {brew.battery !== null && (
                              <rect 
                                x="4" 
                                y="8" 
                                width={`${(brew.battery / 100) * 14}`} 
                                height="8" 
                                rx="1" 
                                fill={batteryColor}
                                className="transition-all duration-500"
                                opacity="0.6"
                              />
                            )}
                          </svg>
                        </div>
                        <p className="text-muted-foreground/60 tracking-wide z-10 pl-2 font-normal" style={{ fontSize: 'min(1.8vh, 1vw)' }}>Batteri</p>
                        <p 
                          className={`font-bold leading-none z-10 pl-2 ${updatedFields[brew.batch_id]?.battery ? 'animate-value-shimmer' : ''} ${!isInactive && brew.battery !== null && brew.battery < 20 ? 'animate-battery-pulse' : ''}`}
                          style={{ 
                            fontSize: 'min(5.5vh, 2.5vw)',
                            color: !isInactive && brew.battery !== null && brew.battery < 20 ? 'hsl(0 70% 50%)' : batteryColor,
                            textShadow: !isInactive && brew.battery !== null && brew.battery < 20 ? '0 0 15px hsl(0 70% 50% / 0.4)' : `0 0 15px ${batteryColor}30`
                          }}
                        >
                          {isInactive ? "--" : (brew.battery !== null ? `${brew.battery}%` : "--")}
                        </p>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </Card>
    );
  }
}
