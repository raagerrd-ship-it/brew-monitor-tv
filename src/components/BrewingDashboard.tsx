import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { BrewChart } from "./BrewChart";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Settings, Loader2, Droplets, Thermometer, TrendingDown, Wine, Battery } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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
  battery: number | null;
  sgData: Array<{ date: string; value: number; temp: number }>;
}

export function BrewingDashboard() {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [brews, setBrews] = useState<BrewData[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatedFields, setUpdatedFields] = useState<Record<string, Record<string, boolean>>>({});
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000); // Update every second

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    loadBrews();
  }, []);

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
          if (payload.eventType === 'UPDATE' && payload.new && payload.old) {
            const updatedReading = payload.new as any;
            const oldReading = payload.old as any;
            
            // Track which fields changed
            const changedFields: Record<string, boolean> = {};
            if (updatedReading.current_sg !== oldReading.current_sg) changedFields.sg = true;
            if (updatedReading.current_temp !== oldReading.current_temp) changedFields.temp = true;
            if (updatedReading.attenuation !== oldReading.attenuation) changedFields.attenuation = true;
            if (updatedReading.abv !== oldReading.abv) changedFields.abv = true;
            if (updatedReading.battery !== oldReading.battery) changedFields.battery = true;
            
            setBrews(prevBrews => 
              prevBrews.map(brew => 
                brew.batch_id === updatedReading.batch_id
                  ? {
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
                      sgData: updatedReading.sg_data || []
                    }
                  : brew
              )
            );
            
            // Set glow effect for changed fields
            if (Object.keys(changedFields).length > 0) {
              setUpdatedFields(prev => ({
                ...prev,
                [updatedReading.batch_id]: changedFields
              }));
              
              // Remove glow after 10 seconds
              setTimeout(() => {
                setUpdatedFields(prev => {
                  const newFields = { ...prev };
                  delete newFields[updatedReading.batch_id];
                  return newFields;
                });
              }, 10000);
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
      const brewsData = brewReadings.map((reading: any) => ({
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
        battery: reading.battery,
        sgData: reading.sg_data || []
      }));

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

  return (
    <div className="h-screen w-screen bg-background flex flex-col overflow-hidden">
      {/* Compact Header Bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/50 backdrop-blur-sm bg-background/80 flex-shrink-0">
        <h1 className="text-xl md:text-2xl font-bold bg-gradient-to-r from-beer-amber via-primary to-ferment-green bg-clip-text text-transparent animate-gradient bg-[length:200%_auto]">
          Bryggövervakare
        </h1>
        
        <div className="flex items-center gap-3">
          <p className="text-xs text-muted-foreground tabular-nums">
            {currentTime.toLocaleTimeString("sv-SE", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </p>
          
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/settings')}
            className="opacity-5 hover:opacity-20 transition-opacity h-5 w-5"
          >
            <Settings className="h-2.5 w-2.5" />
          </Button>
        </div>
      </div>

      {/* Main Display Area - All Brews */}
      <div className="flex-1 p-2 overflow-hidden">
        <div className={`grid gap-2 ${getGridLayout()} h-full w-full`}>
          {brews.map((brew) => (
            <Card 
              key={brew.id}
              className="bg-gradient-card border-border shadow-deep flex flex-col overflow-hidden h-full"
            >
              {/* Header - 10% */}
              <div className="h-[10%] p-2 pb-1 border-b border-border/50 flex-shrink-0">
                <div className="flex items-center justify-between gap-2 h-full">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-xl font-bold text-foreground leading-tight truncate">
                      {brew.name}
                    </h2>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {brew.style} • #{brew.batchNumber}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-1 text-[10px] font-semibold whitespace-nowrap flex-shrink-0 ${
                      brew.status === "Konditionering"
                        ? "bg-primary/20 text-primary"
                        : "bg-ferment-green/20 text-ferment-green animate-pulse"
                    }`}
                  >
                    {brew.status}
                  </span>
                </div>
              </div>
              
              {/* Chart Area - 53% */}
              <div className="h-[53%] p-2 flex-shrink-0">
                <BrewChart 
                  data={brew.sgData} 
                  og={brew.originalGravity} 
                  fg={brew.finalGravity} 
                  singleView={true} 
                />
              </div>

              {/* Stats Grid - 37% */}
              <div className="h-[37%] p-2 pt-0 pb-2 flex-shrink-0">
                <div className="grid grid-cols-3 gap-2 h-full">
                  {/* SG - Large Featured Card */}
                  <div 
                    className={`col-span-1 row-span-2 bg-background/50 rounded-lg p-2 flex flex-col items-center justify-between border border-primary/20 transition-all duration-1000 ${
                      updatedFields[brew.batch_id]?.sg ? 'shadow-[0_0_20px_hsl(var(--primary)/0.6)] border-primary/60' : ''
                    }`}
                    style={{ containerType: 'size' }}
                  >
                    <div className="flex items-center justify-center w-full" style={{ height: 'calc(40cqh - 0.5rem)' }}>
                      <div className="inline-flex rounded-full bg-primary/20 p-2 aspect-square" style={{ height: 'calc(100% - 0.5rem)' }}>
                        <Droplets className="h-full w-full text-primary" />
                      </div>
                    </div>
                    <p className="text-muted-foreground uppercase tracking-wider flex items-center justify-center" style={{ height: 'calc(20cqh - 0.5rem)', fontSize: 'calc((20cqh - 0.5rem) * 0.4)' }}>SG</p>
                    <p className="font-bold text-primary leading-none flex items-center justify-center" style={{ height: 'calc(40cqh - 0.5rem)', fontSize: 'calc((40cqh - 0.5rem) * 0.7)' }}>
                      {brew.currentSG.toFixed(3)}
                    </p>
                  </div>

                  {/* ABV */}
                  <div 
                    className={`bg-background/50 rounded-lg p-1.5 flex flex-col items-center justify-between border border-secondary/20 transition-all duration-1000 ${
                      updatedFields[brew.batch_id]?.abv ? 'shadow-[0_0_20px_hsl(var(--secondary)/0.6)] border-secondary/60' : ''
                    }`}
                    style={{ containerType: 'size' }}
                  >
                    <div className="flex items-center justify-center w-full" style={{ height: 'calc(40cqh - 0.375rem)' }}>
                      <div className="inline-flex rounded-full bg-secondary/20 p-1 aspect-square" style={{ height: 'calc(100% - 0.5rem)' }}>
                        <Wine className="h-full w-full text-secondary" />
                      </div>
                    </div>
                    <p className="text-muted-foreground uppercase tracking-wider flex items-center justify-center" style={{ height: 'calc(20cqh - 0.375rem)', fontSize: 'calc((20cqh - 0.375rem) * 0.4)' }}>ABV</p>
                    <p className="font-bold text-secondary leading-none flex items-center justify-center" style={{ height: 'calc(40cqh - 0.375rem)', fontSize: 'calc((40cqh - 0.375rem) * 0.65)' }}>
                      {brew.abv}%
                    </p>
                  </div>

                  {/* Temp */}
                  <div 
                    className={`bg-background/50 rounded-lg p-1.5 flex flex-col items-center justify-between border border-temp-blue/20 transition-all duration-1000 ${
                      updatedFields[brew.batch_id]?.temp ? 'shadow-[0_0_20px_hsl(var(--temp-blue)/0.6)] border-temp-blue/60' : ''
                    }`}
                    style={{ containerType: 'size' }}
                  >
                    <div className="flex items-center justify-center w-full" style={{ height: 'calc(40cqh - 0.375rem)' }}>
                      <div className="inline-flex rounded-full bg-temp-blue/20 p-1 animate-pulse aspect-square" style={{ height: 'calc(100% - 0.5rem)' }}>
                        <Thermometer className="h-full w-full text-temp-blue" />
                      </div>
                    </div>
                    <p className="text-muted-foreground uppercase tracking-wider flex items-center justify-center" style={{ height: 'calc(20cqh - 0.375rem)', fontSize: 'calc((20cqh - 0.375rem) * 0.4)' }}>Temp</p>
                    <p className="font-bold text-temp-blue leading-none flex items-center justify-center" style={{ height: 'calc(40cqh - 0.375rem)', fontSize: 'calc((40cqh - 0.375rem) * 0.65)' }}>
                      {brew.currentTemp}°
                    </p>
                  </div>

                  {/* Utjäsning */}
                  <div 
                    className={`bg-background/50 rounded-lg p-1.5 flex flex-col items-center justify-between border border-ferment-green/20 transition-all duration-1000 ${
                      updatedFields[brew.batch_id]?.attenuation ? 'shadow-[0_0_20px_hsl(var(--ferment-green)/0.6)] border-ferment-green/60' : ''
                    }`}
                    style={{ containerType: 'size' }}
                  >
                    <div className="flex items-center justify-center w-full" style={{ height: 'calc(35cqh - 0.375rem)' }}>
                      <div className="inline-flex rounded-full bg-ferment-green/20 p-1 aspect-square" style={{ height: 'calc(100% - 0.5rem)' }}>
                        <TrendingDown className="h-full w-full text-ferment-green" />
                      </div>
                    </div>
                    <p className="text-muted-foreground uppercase tracking-wider flex items-center justify-center" style={{ height: 'calc(15cqh - 0.25rem)', fontSize: 'calc((15cqh - 0.25rem) * 0.45)' }}>Utjäsning</p>
                    <div className="flex flex-col items-center justify-center w-full gap-1" style={{ height: 'calc(50cqh - 0.375rem)' }}>
                      <p className="font-bold text-ferment-green leading-none" style={{ fontSize: 'calc((50cqh - 0.375rem) * 0.5)' }}>
                        {brew.attenuation}%
                      </p>
                      <Progress 
                        value={brew.attenuation} 
                        className={`h-1 w-full bg-background [&>div]:bg-ferment-green [&>div]:rounded-full transition-all duration-500 ${
                          brew.attenuation > 75 ? '[&>div]:shadow-[0_0_15px_hsl(var(--ferment-green))]' : ''
                        }`} 
                      />
                    </div>
                  </div>

                  {/* Batteri */}
                  <div 
                    className={`bg-background/50 rounded-lg p-1.5 flex flex-col items-center justify-between border border-primary/20 transition-all duration-1000 ${
                      updatedFields[brew.batch_id]?.battery ? 'shadow-[0_0_20px_hsl(var(--primary)/0.6)] border-primary/60' : ''
                    }`}
                    style={{ containerType: 'size' }}
                  >
                    <div className="flex items-center justify-center w-full" style={{ height: 'calc(35cqh - 0.375rem)' }}>
                      <div className="inline-flex rounded-full bg-primary/20 p-1 aspect-square" style={{ height: 'calc(100% - 0.5rem)' }}>
                        <Battery className="h-full w-full text-primary" />
                      </div>
                    </div>
                    <p className="text-muted-foreground uppercase tracking-wider flex items-center justify-center" style={{ height: 'calc(15cqh - 0.25rem)', fontSize: 'calc((15cqh - 0.25rem) * 0.45)' }}>Batteri</p>
                    <div className="flex flex-col items-center justify-center w-full gap-1" style={{ height: 'calc(50cqh - 0.375rem)' }}>
                      <p className="font-bold text-primary leading-none" style={{ fontSize: 'calc((50cqh - 0.375rem) * 0.5)' }}>
                        {brew.battery !== null ? `${brew.battery}%` : "N/A"}
                      </p>
                      {brew.battery !== null && (
                        <Progress 
                          value={brew.battery} 
                          className={`h-1 w-full bg-background [&>div]:bg-primary [&>div]:rounded-full transition-all duration-500 ${
                            brew.battery < 25 ? '[&>div]:bg-destructive' : ''
                          }`} 
                        />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
