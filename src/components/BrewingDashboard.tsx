import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SyncCountdown } from "./SyncCountdown";
import { RaptControllerDialog } from "./RaptControllerDialog";
import { BrewDeviceLinkDialog } from "./BrewDeviceLinkDialog";
import { BrewCard } from "./brew-card";
import { Logo } from "./Logo";
import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Settings, Loader2, Pill, AirVent } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { toast as sonnerToast } from "sonner";
import useEmblaCarousel from "embla-carousel-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useVersionCheck } from "@/hooks/use-version-check";
import { BrewData, BrewEvent, PillData, TempController } from "@/types/brew";
import { getControllerColor, calculateFermentationRate } from "@/lib/brew-utils";

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
  const { appLoadTime } = useVersionCheck(60000);

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
                      duration: 5000,
                    });
                    
                    // Auto-acknowledge in database
                    supabase
                      .from('brew_readings')
                      .update({ coldcrash_acknowledged: true })
                      .eq('batch_id', brew.batch_id);
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

  return (
    <div className="h-screen w-screen bg-background flex flex-col overflow-hidden relative">
      {/* Version indicator - bottom right */}
      <div 
        className="absolute bottom-2 right-3 z-50 text-muted-foreground/30 font-mono"
        style={{ fontSize: 'min(1.5vh, 0.7vw)' }}
      >
        Laddad: {appLoadTime.toLocaleString('sv-SE', { 
          month: 'short', 
          day: 'numeric', 
          hour: '2-digit', 
          minute: '2-digit',
          second: '2-digit'
        })}
      </div>
      {/* Header Bar - Clean Modern Design */}
      <div 
        className={`flex-shrink-0 overflow-visible relative z-10 ${isMobile ? 'flex flex-col py-3 px-3 gap-3' : 'h-[11%] flex items-center justify-between px-6 gap-6'}`}
        style={{ 
          containerType: 'size',
          ...(isMobile ? {} : {
            background: 'linear-gradient(180deg, hsl(222 18% 12%) 0%, hsl(222 20% 9%) 100%)',
            borderBottom: '1px solid hsl(222 15% 16%)',
          })
        }}
      >
        {/* Subtle top highlight - desktop only */}
        {!isMobile && (
          <div 
            className="absolute inset-x-0 top-0 h-px"
            style={{ background: 'linear-gradient(90deg, transparent 0%, hsl(222 15% 25%) 20%, hsl(222 15% 25%) 80%, transparent 100%)' }}
          />
        )}
        
        {/* Mobile: Logo row with settings */}
        {isMobile ? (
          <div className="flex items-center justify-between w-full">
            <Logo />
            <div 
              className="relative flex items-center justify-center" 
              style={{ width: '36px', height: '36px' }}
            >
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate('/settings')}
                className="opacity-40 hover:opacity-100 hover:bg-transparent transition-opacity duration-200 w-full h-full rounded-full"
              >
                <Settings className="w-5 h-5" />
              </Button>
              <SyncCountdown className="w-full h-full" />
            </div>
          </div>
        ) : null}
        
        {/* RAPT Section - Mobile */}
        {isMobile && raptControllers.length > 0 && (
          <div 
            className="flex items-center justify-center w-full"
          >
            <div 
              className="flex items-center rounded-lg gap-1 px-2 py-2 overflow-x-auto scrollbar-hide"
              style={{
                background: 'hsl(222 20% 11%)',
                border: '1px solid hsl(222 15% 18%)',
                boxShadow: '0 6px 20px hsl(222 30% 3% / 0.6), 0 3px 8px hsl(222 30% 3% / 0.4), inset 0 1px 0 hsl(0 0% 100% / 0.04)',
              }}
            >
              {raptControllers.map((controller, index) => {
                const controllerColor = getControllerColor(controller.name);
                const linkedPill = raptPills.find(p => p.pill_id === controller.linked_pill_id);
                const isPillStale = linkedPill?.last_update ? 
                  ((new Date().getTime() - new Date(linkedPill.last_update).getTime()) / (1000 * 60 * 60)) > 24 
                  : true;
                
                return (
                  <div key={controller.id} className="flex items-center">
                    {index > 0 && (
                      <div 
                        className="h-6 mx-1 w-px"
                        style={{ background: 'hsl(222 15% 20%)' }}
                      />
                    )}
                    
                    <div 
                      className="flex items-center cursor-pointer flex-shrink-0 transition-all duration-200 rounded px-2 py-1 gap-2"
                      style={{ background: 'transparent' }}
                      onClick={() => {
                        setSelectedController(controller);
                        setControllerDialogOpen(true);
                      }}
                    >
                      <AirVent 
                        style={{
                          width: '1rem',
                          height: '1rem',
                          color: controllerColor,
                          flexShrink: 0,
                          opacity: 0.7,
                        }}
                      />
                      
                      <span 
                        className="font-semibold tabular-nums whitespace-nowrap text-sm"
                        style={{ color: linkedPill?.color || 'hsl(var(--foreground))' }}
                      >
                        {controller.pill_temp !== null 
                          ? `${controller.pill_temp.toFixed(1)}°C` 
                          : controller.current_temp !== null 
                            ? `${controller.current_temp.toFixed(1)}°C` 
                            : '--°C'
                        }
                      </span>
                      
                      {linkedPill && (
                        <div 
                          className={`flex items-center gap-1 transition-opacity ${isPillStale ? 'opacity-40' : 'opacity-60'}`}
                        >
                          <Pill
                            style={{
                              width: '0.7rem',
                              height: '0.7rem',
                              flexShrink: 0,
                            }}
                            color={linkedPill.color}
                            strokeWidth={2}
                          />
                          <span 
                            className="tabular-nums whitespace-nowrap text-[10px]"
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
          </div>
        )}
        
        {/* Desktop: Three-column layout - Logo | RAPT (centered) | Clock+Settings */}
        {!isMobile && (
          <>
            {/* Left column: Logo */}
            <div className="flex items-center flex-shrink-0">
              <Logo />
            </div>
            
            {/* Center column: RAPT Section */}
            <div className="flex-1 flex items-center justify-center">
              {raptControllers.length > 0 && (
                <div 
                  className="flex items-center rounded-lg gap-1.5 px-2 py-1.5"
                  style={{
                    background: 'hsl(222 20% 11%)',
                    border: '1px solid hsl(222 15% 18%)',
                    boxShadow: '0 6px 20px hsl(222 30% 3% / 0.6), 0 3px 8px hsl(222 30% 3% / 0.4), inset 0 1px 0 hsl(0 0% 100% / 0.04)',
                  }}
                >
                  {raptControllers.map((controller, index) => {
                    const controllerColor = getControllerColor(controller.name);
                    const linkedPill = raptPills.find(p => p.pill_id === controller.linked_pill_id);
                    const isPillStale = linkedPill?.last_update ? 
                      ((new Date().getTime() - new Date(linkedPill.last_update).getTime()) / (1000 * 60 * 60)) > 24 
                      : true;
                    
                    return (
                      <div key={controller.id} className="flex items-center">
                        {index > 0 && (
                          <div 
                            className="h-8 mx-1.5 w-px"
                            style={{ background: 'hsl(222 15% 20%)' }}
                          />
                        )}
                        
                        <div 
                          className="flex items-center cursor-pointer flex-shrink-0 transition-all duration-200 rounded px-2.5 py-1.5 gap-2.5"
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
                          <AirVent 
                            style={{
                              width: '1.1rem',
                              height: '1.1rem',
                              color: controllerColor,
                              flexShrink: 0,
                              opacity: 0.7,
                            }}
                          />
                          
                          <span 
                            className="font-semibold tabular-nums whitespace-nowrap"
                            style={{
                              fontSize: 'min(2.6vh, 1.5vw)',
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
                          
                          {linkedPill && (
                            <div 
                              className={`flex items-center gap-1 transition-opacity ${isPillStale ? 'opacity-40' : 'opacity-60'}`}
                              title={`${linkedPill.name}\nBatteri: ${linkedPill.battery_level}%${isPillStale ? '\n⚠️ Ingen uppdatering på >24h' : ''}`}
                            >
                              <div className="relative flex items-center">
                                <Pill
                                  style={{
                                    width: '0.85rem',
                                    height: '0.85rem',
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
                                className="font-semibold tabular-nums whitespace-nowrap"
                                style={{ 
                                  fontSize: 'min(2.2vh, 1.3vw)',
                                  color: linkedPill.color,
                                  textShadow: `0 0 10px ${linkedPill.color}40`
                                }}
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
            </div>
            
            {/* Right column: Clock and Settings */}
            <div className="flex items-center gap-4 flex-shrink-0">
              {/* Clock Section */}
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
          </>
        )}
      </div>

      {/* Main Display Area - All Brews */}
      <div className="flex-1 overflow-hidden relative flex flex-col z-0">
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
          <div className="flex flex-col flex-1 pt-[90px]">
            {/* Pagination dots */}
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
              </div>
            )}
            
            <div className="flex-1 overflow-hidden px-3 pb-2" ref={emblaRef}>
              <div className="flex h-full">
                {brews.map((brew) => (
                  <div key={brew.id} className="flex-[0_0_100%] min-w-0 px-3">
                    <BrewCard
                      brew={brew}
                      updatedFields={updatedFields}
                      isAuthenticated={isAuthenticated}
                      pills={pills}
                      controllers={controllers}
                      onShareBrew={handleShareBrew}
                      onEventsChange={loadBrewEvents}
                      onDeviceLinkOpen={(brewId, brewName, controllerId, pillId) => 
                        setDeviceLinkDialog({
                          open: true,
                          brewId,
                          brewName,
                          currentControllerId: controllerId,
                          currentPillId: pillId,
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          // Desktop: Grid/Flex layout
          <div className={`${getGridLayout()} h-full w-full p-4 py-6`}>
            {brews.map((brew) => (
              <div key={brew.id} className={getCardWidthClass()}>
                <BrewCard
                  brew={brew}
                  updatedFields={updatedFields}
                  isAuthenticated={isAuthenticated}
                  pills={pills}
                  controllers={controllers}
                  onShareBrew={handleShareBrew}
                  onEventsChange={loadBrewEvents}
                  onDeviceLinkOpen={(brewId, brewName, controllerId, pillId) => 
                    setDeviceLinkDialog({
                      open: true,
                      brewId,
                      brewName,
                      currentControllerId: controllerId,
                      currentPillId: pillId,
                    })
                  }
                />
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
}
