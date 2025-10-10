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
          loadBrews()
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
      <div className="flex-1 overflow-auto p-3">
        <div className="grid gap-3 grid-cols-1">
          {brews.map((brew) => (
            <div 
              key={brew.id}
              className="flex gap-3 min-h-[400px]"
            >
              {/* Left Side - Chart (65% width) */}
              <div className="flex-[65] flex flex-col">
                <Card className="bg-gradient-card border-border shadow-deep flex-1 flex flex-col overflow-hidden">
                  <div className="p-3 pb-2 border-b border-border/50 flex-shrink-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold text-foreground leading-tight truncate">
                          {brew.name}
                        </h2>
                        <p className="text-xs md:text-sm text-muted-foreground truncate">
                          {brew.style} • Sats {brew.batchNumber} • Senast uppdaterad: {brew.lastUpdate}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-3 py-1 text-xs md:text-sm font-semibold whitespace-nowrap flex-shrink-0 ${
                          brew.status === "Konditionering"
                            ? "bg-primary/20 text-primary"
                            : "bg-ferment-green/20 text-ferment-green animate-pulse"
                        }`}
                      >
                        {brew.status}
                      </span>
                    </div>
                  </div>
                  
                  <div className="flex-1 p-3 min-h-0 overflow-hidden">
                    <BrewChart 
                      data={brew.sgData} 
                      og={brew.originalGravity} 
                      fg={brew.finalGravity} 
                      singleView={true} 
                    />
                  </div>
                </Card>
              </div>

              {/* Right Side - Stats (35% width) */}
              <div className="flex-[35] flex flex-col gap-2">
                {/* SG Card - Larger */}
                <Card className="bg-gradient-card border-border shadow-deep p-4 border-2 border-primary/20 flex-[3]">
                  <div className="text-center h-full flex flex-col justify-center">
                    <div className="inline-flex rounded-full bg-primary/20 p-2 mb-2 mx-auto">
                      <Droplets className="h-7 w-7 md:h-8 md:w-8 text-primary" />
                    </div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">SG</p>
                    <p className="text-4xl md:text-5xl lg:text-6xl font-bold text-primary leading-none mb-2">
                      {brew.currentSG.toFixed(3)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Start: {brew.originalGravity.toFixed(3)}
                    </p>
                  </div>
                </Card>

                {/* Utjäsning & Battery - Grid */}
                <div className="grid grid-cols-2 gap-2 flex-[3]">
                  <Card className="bg-gradient-card border-border shadow-deep p-4 border-2 border-ferment-green/20">
                    <div className="text-center h-full flex flex-col justify-center">
                      <div className="inline-flex rounded-full bg-ferment-green/20 p-2 mb-2 mx-auto">
                        <TrendingDown className="h-6 w-6 md:h-7 md:w-7 text-ferment-green" />
                      </div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Utjäsning</p>
                      <p className="text-3xl md:text-4xl font-bold text-ferment-green leading-none mb-2">
                        {brew.attenuation}%
                      </p>
                      <Progress 
                        value={brew.attenuation} 
                        className={`h-2 bg-background [&>div]:bg-ferment-green [&>div]:rounded-full transition-all duration-500 ${
                          brew.attenuation > 75 ? '[&>div]:shadow-[0_0_15px_hsl(var(--ferment-green))]' : ''
                        }`} 
                      />
                    </div>
                  </Card>

                  <Card className="bg-gradient-card border-border shadow-deep p-4 border-2 border-primary/20">
                    <div className="text-center h-full flex flex-col justify-center">
                      <div className="inline-flex rounded-full bg-primary/20 p-2 mb-2 mx-auto">
                        <Battery className="h-6 w-6 md:h-7 md:w-7 text-primary" />
                      </div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Batteri</p>
                      <p className="text-3xl md:text-4xl font-bold text-primary leading-none mb-2">
                        {brew.battery !== null ? `${brew.battery}%` : 'N/A'}
                      </p>
                      {brew.battery !== null && (
                        <Progress 
                          value={brew.battery} 
                          className={`h-2 bg-background [&>div]:bg-primary [&>div]:rounded-full transition-all duration-500 ${
                            brew.battery < 25 ? '[&>div]:bg-destructive' : ''
                          }`} 
                        />
                      )}
                    </div>
                  </Card>
                </div>

                {/* Temp & ABV - Smaller */}
                <div className="grid grid-cols-2 gap-2 flex-[2]">
                  <Card className="bg-gradient-card border-border shadow-deep p-2 border-2 border-temp-blue/20">
                    <div className="text-center h-full flex flex-col justify-center">
                      <div className="inline-flex rounded-full bg-temp-blue/20 p-1 mb-1 mx-auto animate-pulse">
                        <Thermometer className="h-3 w-3 md:h-4 md:w-4 text-temp-blue" />
                      </div>
                      <p className="text-[8px] text-muted-foreground uppercase tracking-wider mb-0.5">Temp</p>
                      <p className="text-xl md:text-2xl font-bold text-temp-blue leading-none">
                        {brew.currentTemp}°
                      </p>
                    </div>
                  </Card>

                  <Card className="bg-gradient-card border-border shadow-deep p-2 border-2 border-secondary/20">
                    <div className="text-center h-full flex flex-col justify-center">
                      <div className="inline-flex rounded-full bg-secondary/20 p-1 mb-1 mx-auto">
                        <Wine className="h-3 w-3 md:h-4 md:w-4 text-secondary" />
                      </div>
                      <p className="text-[8px] text-muted-foreground uppercase tracking-wider mb-0.5">ABV</p>
                      <p className="text-xl md:text-2xl font-bold text-secondary leading-none">
                        {brew.abv}%
                      </p>
                    </div>
                  </Card>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
