import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { BrewChart } from "./BrewChart";
import { SyncCountdown } from "./SyncCountdown";
import { RaptPills } from "./RaptPills";
import { RaptTempControllers } from "./RaptTempControllers";
import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Settings, Loader2, Droplets, Thermometer, TrendingDown, Wine, Battery, ChevronLeft, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import useEmblaCarousel from "embla-carousel-react";
import { useIsMobile } from "@/hooks/use-mobile";

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
}

export function BrewingDashboard() {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [brews, setBrews] = useState<BrewData[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatedFields, setUpdatedFields] = useState<Record<string, Record<string, boolean>>>({});
  const navigate = useNavigate();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: false, align: "center" });
  const [selectedIndex, setSelectedIndex] = useState(0);
  
  // Ref to hold the latest brews state for realtime comparison
  const brewsRef = useRef<BrewData[]>([]);
  
  // Ref to track brews that have already shown the coldcrash notification
  const coldcrashNotifiedRef = useRef<Set<string>>(new Set());
  
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
  }, []);

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
                  const newSgData = updatedReading.sg_data || [];
                  const newFermentationRate = calculateFermentationRate(newSgData);
                  
                  // Check if fermentation has stopped (rate is 0.000)
                  if (
                    newFermentationRate !== null && 
                    Math.abs(newFermentationRate) < 0.0005 && // Essentially 0.000 when rounded to 3 decimals
                    !coldcrashNotifiedRef.current.has(brew.batch_id)
                  ) {
                    coldcrashNotifiedRef.current.add(brew.batch_id);
                    toast({
                      title: `${updatedReading.name} är klar! 🍺`,
                      description: "Jäsningen är färdig (0.000/dag). Dags för Coldcrash!",
                      duration: 10000,
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
                    fermentationRate: newFermentationRate
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

    return () => {
      supabase.removeChannel(brewChannel)
    }
  }, []);

  // Calculate fermentation rate (SG change per 24h based on last 24 hours)
  const calculateFermentationRate = (sgData: Array<{ date: string; value: number; temp: number }>): number | null => {
    if (!sgData || sgData.length < 2) return null;
    
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    // Filter readings from last 24 hours
    const recentReadings = sgData.filter(d => new Date(d.date) >= twentyFourHoursAgo).sort((a, b) => 
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    
    if (recentReadings.length < 2) {
      // If less than 24 hours of data, use all available data
      const sortedData = [...sgData].sort((a, b) => 
        new Date(a.date).getTime() - new Date(b.date).getTime()
      );
      
      if (sortedData.length < 2) return null;
      
      const firstReading = sortedData[0];
      const lastReading = sortedData[sortedData.length - 1];
      
      const timeDiffMs = new Date(lastReading.date).getTime() - new Date(firstReading.date).getTime();
      const timeDiffHours = timeDiffMs / (1000 * 60 * 60);
      
      if (timeDiffHours === 0) return null;
      
      const sgDiff = firstReading.value - lastReading.value; // Positive = fermentation happening
      const ratePerHour = sgDiff / timeDiffHours;
      return ratePerHour * 24; // Convert to per 24h
    }
    
    const firstReading = recentReadings[0];
    const lastReading = recentReadings[recentReadings.length - 1];
    
    const timeDiffMs = new Date(lastReading.date).getTime() - new Date(firstReading.date).getTime();
    const timeDiffHours = timeDiffMs / (1000 * 60 * 60);
    
    if (timeDiffHours === 0) return null;
    
    const sgDiff = firstReading.value - lastReading.value; // Positive = fermentation happening
    const ratePerHour = sgDiff / timeDiffHours;
    return ratePerHour * 24; // Convert to per 24h
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
        .order('created_at')

      if (readingsError) throw readingsError;

      if (!brewReadings || brewReadings.length === 0) {
        setBrews([]);
        setLoading(false);
        return;
      }

      // Transform database data to component format
      const brewsData = brewReadings.map((reading: any) => {
        const sgData = reading.sg_data || [];
        const fermentationRate = calculateFermentationRate(sgData);
        
        // Check if fermentation has stopped on initial load
        if (
          fermentationRate !== null && 
          Math.abs(fermentationRate) < 0.0005 && // Essentially 0.000 when rounded to 3 decimals
          !coldcrashNotifiedRef.current.has(reading.batch_id)
        ) {
          coldcrashNotifiedRef.current.add(reading.batch_id);
          toast({
            title: `${reading.name} är klar! 🍺`,
            description: "Jäsningen är färdig (0.000/dag). Dags för Coldcrash!",
            duration: 10000,
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
          fermentationRate: fermentationRate
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
      {/* Compact Header Bar */}
      <div className="h-[8%] flex items-center justify-between border-b border-border/50 backdrop-blur-sm bg-background/80 flex-shrink-0 overflow-visible px-6 gap-4" style={{ containerType: 'size' }}>
        <h1 className="font-bold bg-gradient-to-r from-beer-amber via-primary to-ferment-green bg-clip-text text-transparent animate-gradient bg-[length:200%_auto] leading-relaxed pb-0.5" style={{ fontSize: 'min(calc(60cqh * 0.8), calc(100cqw * 0.035))' }}>
          Bryggövervakare
        </h1>
        
        <div className="flex items-center gap-4">
          <div data-name="RaptMain" className="flex items-stretch justify-end gap-3 bg-yellow-500/20">
            <RaptTempControllers dynamicSize={true} className="bg-green-500/20" />
            <RaptPills dynamicSize={true} className="bg-blue-500/20" />
          </div>
          
          <div className="flex flex-col items-end min-w-[12%] gap-0 bg-purple-500/20">
            <p className="font-semibold tabular-nums tracking-tight" style={{ fontSize: 'min(calc(42cqh * 0.8), calc(100cqw * 0.026))' }}>
              {currentTime.toLocaleTimeString("sv-SE", {
                hour: "2-digit",
                minute: "2-digit",
              })}:{currentTime.getSeconds().toString().padStart(2, '0')}
            </p>
            <p className="text-muted-foreground/70 uppercase tracking-wider font-semibold -mt-1" style={{ fontSize: 'min(calc(24cqh * 0.7), calc(100cqw * 0.013))' }}>
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
            
            <div className="flex-1 overflow-hidden px-3" ref={emblaRef}>
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
          <div className={`grid gap-6 ${getGridLayout()} h-full w-full p-4`}>
            {brews.map((brew) => renderBrewCard(brew, updatedFields, getTempColor))}
          </div>
        )}
      </div>
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
                    <p className="text-muted-foreground truncate" style={{ fontSize: 'min(calc(25cqh * 0.8), calc(100cqw * 0.11))' }}>
                      {brew.style} • {brew.lastUpdate} • {brew.batchNumber}
                    </p>
                  </div>
                  <span
                    className="rounded-full px-4 py-2 font-bold whitespace-nowrap flex-shrink-0"
                    style={{ 
                      fontSize: 'min(calc(30cqh * 0.7), calc(100cqw * 0.12))',
                      backgroundColor: brew.status === "Konditionering" ? "hsl(var(--primary) / 0.2)" : "hsl(var(--ferment-green) / 0.2)",
                      color: brew.status === "Konditionering" ? "hsl(var(--primary))" : "hsl(var(--ferment-green))",
                      animation: brew.status === "Konditionering" ? "none" : "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite"
                    }}
                  >
                    {brew.status}
                  </span>
                </div>
              </div>
              
              {/* Chart Area - 58% */}
              <div className="h-[58%] p-2 pb-1 flex-shrink-0">
                <BrewChart 
                  data={brew.sgData} 
                  og={brew.originalGravity} 
                  fg={brew.finalGravity} 
                  singleView={true} 
                />
              </div>

              {/* Stats Grid - 32% */}
              <div className="h-[32%] p-2 pt-1 pb-2 flex-shrink-0">
                <div className="grid grid-cols-3 gap-4 h-full">
                  {/* SG - Large Featured Card */}
                  <div 
                    className={`col-span-1 row-span-2 bg-background/50 rounded-lg p-2 flex flex-col items-center justify-center gap-1 border border-primary/20 transition-all duration-1000 relative overflow-hidden ${
                      updatedFields[brew.batch_id]?.sg ? 'shadow-[0_0_20px_hsl(var(--primary)/0.6)] border-primary/60' : ''
                    }`}
                    style={{ containerType: 'size' }}
                  >
                    <p className="text-muted-foreground uppercase tracking-wider flex items-center justify-center z-10" style={{ fontSize: 'min(calc(18cqh * 0.9), calc(100cqw * 0.16))' }}>Gravity</p>
                    <p className="font-bold text-primary leading-none flex items-center justify-center z-10" style={{ fontSize: 'min(calc(35cqh * 0.95), calc(100cqw * 0.28))' }}>
                      {brew.currentSG.toFixed(3)}
                    </p>
                    <div className="text-muted-foreground mt-1 space-y-0.5 z-10 text-center">
                      <p style={{ fontSize: 'min(calc(10cqh * 0.85), calc(100cqw * 0.11))' }}>OG: {brew.originalGravity.toFixed(3)}</p>
                      <p style={{ fontSize: 'min(calc(10cqh * 0.85), calc(100cqw * 0.11))' }}>FG: {brew.finalGravity.toFixed(3)}</p>
                      <p className="font-medium" style={{ fontSize: 'min(calc(10cqh * 0.85), calc(100cqw * 0.11))' }}>
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
                    className={`bg-background/50 rounded-lg p-3 flex flex-col items-start justify-center gap-0 border border-secondary/20 transition-all duration-1000 relative overflow-hidden ${
                      updatedFields[brew.batch_id]?.abv ? 'shadow-[0_0_20px_hsl(var(--secondary)/0.6)] border-secondary/60' : ''
                    }`}
                    style={{ containerType: 'size' }}
                  >
                    <div className="absolute top-1/2 -translate-y-1/2 opacity-20" style={{ width: '60%', height: '60%', right: '-15%' }}>
                      <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
                        {/* Wine glass outline */}
                        <path d="M8 2l-1 12c0 2 2 4 5 4s5-2 5-4L16 2z" stroke="hsl(var(--secondary))" strokeWidth="1" fill="none"/>
                        <path d="M12 18v4M9 22h6" stroke="hsl(var(--secondary))" strokeWidth="1" strokeLinecap="round"/>
                        {/* Wine fill */}
                        <defs>
                          <clipPath id={`wine-clip-${brew.batch_id}`}>
                            <path d="M8 2l-1 12c0 2 2 4 5 4s5-2 5-4L16 2z" />
                          </clipPath>
                        </defs>
                        <rect 
                          x="7" 
                          y={`${18 - (Math.min(Math.max(brew.abv, 0), 10) / 10) * 16}`}
                          width="10" 
                          height="16" 
                          fill="hsl(var(--secondary))"
                          clipPath={`url(#wine-clip-${brew.batch_id})`}
                          className="transition-all duration-500"
                          opacity="0.8"
                        />
                      </svg>
                    </div>
                    <p className="text-muted-foreground uppercase tracking-wider z-10 pl-2" style={{ fontSize: 'min(calc(28cqh * 0.7), calc(100cqw * 0.18))' }}>ABV</p>
                    <p className="font-bold text-secondary leading-none z-10 pl-2" style={{ fontSize: 'min(calc(70cqh * 0.85), calc(100cqw * 0.48))' }}>
                      {brew.abv.toFixed(1)}%
                    </p>
                  </div>

                  {/* Temp */}
                  <div 
                    className={`bg-background/50 rounded-lg p-3 flex flex-col items-start justify-center gap-0 transition-all duration-1000 relative overflow-hidden`}
                    style={{ 
                      containerType: 'size',
                      borderColor: `hsl(${getTempColor(brew.currentTemp).hsl} / 0.2)`,
                      borderWidth: '1px',
                      borderStyle: 'solid',
                      ...(updatedFields[brew.batch_id]?.temp && {
                        boxShadow: `0 0 20px hsl(${getTempColor(brew.currentTemp).hsl} / 0.6)`,
                        borderColor: `hsl(${getTempColor(brew.currentTemp).hsl} / 0.6)`
                      })
                    }}
                  >
                    <div className="absolute top-1/2 -translate-y-1/2 opacity-20 animate-pulse" style={{ width: '60%', height: '60%', right: '-15%' }}>
                      <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
                        {/* Thermometer outline */}
                        <path 
                          d="M14 4v10a4 4 0 1 1-4 0V4a2 2 0 1 1 4 0Z" 
                          stroke={getTempColor(brew.currentTemp).rgb}
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
                          fill={getTempColor(brew.currentTemp).rgb}
                          clipPath={`url(#thermo-clip-${brew.batch_id})`}
                          className="transition-all duration-500"
                          opacity="0.8"
                        />
                      </svg>
                    </div>
                    <p className="text-muted-foreground uppercase tracking-wider z-10 pl-2" style={{ fontSize: 'min(calc(28cqh * 0.7), calc(100cqw * 0.18))' }}>Temp</p>
                    <p 
                      className="font-bold leading-none z-10 pl-2"
                      style={{ 
                        color: getTempColor(brew.currentTemp).rgb,
                        fontSize: 'min(calc(70cqh * 0.85), calc(100cqw * 0.48))'
                      }}
                    >
                      {brew.currentTemp}°
                    </p>
                  </div>

                  {/* Utjäsning */}
                  <div 
                    className={`bg-background/50 rounded-lg p-3 flex flex-col items-start justify-center gap-0 border border-ferment-green/20 transition-all duration-1000 relative overflow-hidden ${
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
                    <p className="text-muted-foreground uppercase tracking-wider z-10 pl-2" style={{ fontSize: 'min(calc(28cqh * 0.7), calc(100cqw * 0.18))' }}>Utjäsning</p>
                    <p className="font-bold text-ferment-green leading-none z-10 pl-2" style={{ fontSize: 'min(calc(70cqh * 0.85), calc(100cqw * 0.48))' }}>
                      {brew.attenuation}%
                    </p>
                  </div>

                  {/* Batteri */}
                  <div 
                    className={`bg-background/50 rounded-lg p-3 flex flex-col items-start justify-center gap-0 border border-primary/20 transition-all duration-1000 relative overflow-hidden ${
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
                    <p className="text-muted-foreground uppercase tracking-wider z-10 pl-2" style={{ fontSize: 'min(calc(28cqh * 0.7), calc(100cqw * 0.18))' }}>Batteri</p>
                    <p className="font-bold text-primary leading-none z-10 pl-2" style={{ fontSize: 'min(calc(70cqh * 0.85), calc(100cqw * 0.48))' }}>
                      {brew.battery !== null ? `${brew.battery}%` : "N/A"}
                    </p>
                  </div>
                </div>
              </div>
            </Card>
    );
  }
}
