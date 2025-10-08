import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BrewStats } from "./BrewStats";
import { BrewChart } from "./BrewChart";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Settings, Loader2 } from "lucide-react";
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
  sgData: Array<{ date: string; value: number; temp: number }>;
}

export function BrewingDashboard() {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [brews, setBrews] = useState<BrewData[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentBrewIndex, setCurrentBrewIndex] = useState(0);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000); // Update every second

    return () => clearInterval(timer);
  }, []);

  // Auto-rotate between brews every 15 seconds
  useEffect(() => {
    if (brews.length <= 1) return;
    
    const rotateTimer = setInterval(() => {
      setCurrentBrewIndex((prev) => (prev + 1) % brews.length);
    }, 15000); // 15 seconds per brew

    return () => clearInterval(rotateTimer);
  }, [brews.length]);

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
    // Set up realtime subscription
    const channel = supabase
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
      supabase.removeChannel(channel)
    }
  }, []);

  const loadBrews = async () => {
    try {
      setLoading(true);

      // Get brew readings from database
      const { data: brewReadings, error: readingsError } = await supabase
        .from('brew_readings')
        .select('*')
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
    <div className="h-screen w-full bg-background flex flex-col overflow-hidden p-6">
      {/* Minimal Header */}
      <div className="mb-6 relative flex-shrink-0">
        <div className="absolute right-0 top-0 flex items-center gap-3">
          <p className="text-sm text-muted-foreground">
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
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/settings')}
            className="opacity-10 hover:opacity-30 transition-opacity"
          >
            <Settings className="h-3 w-3" />
          </Button>
        </div>
        
        <div className="text-center">
          <h1 className="text-5xl font-bold bg-gradient-to-r from-beer-amber via-primary to-ferment-green bg-clip-text text-transparent leading-tight pb-1 animate-gradient bg-[length:200%_auto]">
            Bryggövervakare
          </h1>
        </div>
        
        {/* Brew counter dots */}
        {brews.length > 1 && (
          <div className="flex justify-center gap-2 mt-4">
            {brews.map((_, index) => (
              <div
                key={index}
                className={`h-2 rounded-full transition-all duration-500 ${
                  index === currentBrewIndex 
                    ? 'w-8 bg-primary' 
                    : 'w-2 bg-muted-foreground/30'
                }`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Single Brew Display with Transition */}
      {brews.length > 0 && (
        <div 
          key={currentBrewIndex}
          className="flex-1 flex flex-col gap-6 animate-fade-in"
        >
          {/* Brew Header */}
          <Card className="bg-gradient-card border-border p-6 shadow-deep flex-shrink-0">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-5xl font-bold text-foreground mb-2">
                  {brews[currentBrewIndex].name}
                </h2>
                <p className="text-xl text-muted-foreground">
                  {brews[currentBrewIndex].style} • Sats {brews[currentBrewIndex].batchNumber}
                </p>
              </div>
              <div className="flex flex-col items-end gap-3">
                <span
                  className={`rounded-full px-6 py-3 text-xl font-semibold ${
                    brews[currentBrewIndex].status === "Konditionering"
                      ? "bg-primary/20 text-primary"
                      : "bg-ferment-green/20 text-ferment-green animate-pulse"
                  }`}
                >
                  {brews[currentBrewIndex].status}
                </span>
                <p className="text-sm text-muted-foreground">
                  Uppdaterad: {brews[currentBrewIndex].lastUpdate}
                </p>
              </div>
            </div>

            {/* Large Stats Grid */}
            <BrewStats brew={brews[currentBrewIndex]} />
          </Card>

          {/* Large Chart */}
          <Card className="bg-gradient-card border-border p-6 shadow-deep flex-1 overflow-hidden">
            <h3 className="mb-4 text-2xl font-medium text-muted-foreground uppercase tracking-wide">
              Jäsningsförlopp
            </h3>
            <BrewChart 
              data={brews[currentBrewIndex].sgData} 
              og={brews[currentBrewIndex].originalGravity} 
              fg={brews[currentBrewIndex].finalGravity} 
              singleView={true} 
            />
          </Card>
        </div>
      )}
    </div>
  );
}
