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
    <div className="h-screen w-full bg-background flex flex-col overflow-hidden p-3">
      {/* Header */}
      <div className="mb-3 relative flex-shrink-0">
        <div className="absolute right-0 top-0 flex items-center gap-3">
          <p className="text-xs text-muted-foreground">
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
            className="opacity-30 hover:opacity-100 transition-opacity"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
        
        <div className="text-center py-1">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-beer-amber via-primary to-ferment-green bg-clip-text text-transparent leading-tight pb-1 animate-gradient bg-[length:200%_auto]">
            Bryggövervakare
          </h1>
        </div>
      </div>

      {/* Dynamic Layout based on number of brews */}
      <div className={`grid ${brews.length === 1 ? 'grid-cols-1' : brews.length === 2 ? 'grid-cols-2' : 'grid-cols-3'} ${brews.length === 1 ? 'gap-6 px-8' : 'gap-3'} flex-1 overflow-hidden`}>
        {brews.map((brew) => (
          <div key={brew.id} className={`flex ${brews.length === 1 ? 'flex-col' : 'flex-col'} gap-3 overflow-hidden`}>
            {/* Brew Header Card */}
            <Card className="bg-gradient-card border-border p-3 shadow-deep flex-shrink-0 transition-all duration-300 hover:shadow-xl hover:scale-[1.01]">
              <div className="mb-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-bold text-foreground">
                    {brew.name}
                  </h2>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      brew.status === "Konditionering"
                        ? "bg-primary/20 text-primary"
                        : "bg-ferment-green/20 text-ferment-green animate-pulse"
                    }`}
                  >
                    {brew.status}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {brew.style} • Sats {brew.batchNumber} • Uppdaterad: {brew.lastUpdate}
                </p>
              </div>

              {/* Current Stats */}
              <BrewStats brew={brew} />
            </Card>

            {/* Charts */}
            <Card className="bg-gradient-card border-border p-3 shadow-deep flex-1 overflow-hidden transition-all duration-300 hover:shadow-xl hover:scale-[1.01]">
              <h3 className="mb-2 text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Jäsningsförlopp
              </h3>
              <BrewChart data={brew.sgData} og={brew.originalGravity} fg={brew.finalGravity} singleView={brews.length === 1} />
            </Card>
          </div>
        ))}
      </div>
    </div>
  );
}
