import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { BrewChart } from "./BrewChart";
import { SyncCountdown } from "./SyncCountdown";
import { RaptControllerDialog } from "./RaptControllerDialog";
import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Settings, Loader2, Droplets, Thermometer, TrendingDown, Wine, Battery, Pill, AirVent, Flame, Waves, Timer, Activity } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { toast as sonnerToast } from "sonner";

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
  lastUpdateRaw: string | null;
  battery: number | null;
  sgData: Array<{ date: string; value: number; temp: number }>;
  fermentationRate: number | null;
  coldcrashAcknowledged: boolean;
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
}

export function BrewingDashboard() {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [brews, setBrews] = useState<BrewData[]>([]);
  const [pills, setPills] = useState<PillData[]>([]);
  const [controllers, setControllers] = useState<TempController[]>([]);
  const [selectedController, setSelectedController] = useState<TempController | null>(null);
  const [controllerDialogOpen, setControllerDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [featuredBrewIndex, setFeaturedBrewIndex] = useState(0);
  const navigate = useNavigate();
  const { toast } = useToast();
  const brewsRef = useRef<BrewData[]>([]);

  useEffect(() => {
    brewsRef.current = brews;
  }, [brews]);

  // Auto-rotation timer (20 seconds)
  useEffect(() => {
    if (brews.length <= 1) return;
    
    const rotationTimer = setInterval(() => {
      setFeaturedBrewIndex(prev => (prev + 1) % brews.length);
    }, 20000);

    return () => clearInterval(rotationTimer);
  }, [brews.length]);

  useEffect(() => {
    const updateTime = () => setCurrentTime(new Date());
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    loadBrews();
    loadPills();
    loadControllers();
  }, []);

  // Realtime subscriptions, loadBrews, loadPills, loadControllers, calculateFermentationRate

  const calculateFermentationRate = (sgData: Array<{ date: string; value: number; temp: number }>): number | null => {
    if (!sgData || sgData.length < 2) return null;
    
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    const recentReadings = sgData.filter(d => new Date(d.date) >= twentyFourHoursAgo).sort((a, b) => 
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    
    if (recentReadings.length < 2) {
      const sortedData = [...sgData].sort((a, b) => 
        new Date(a.date).getTime() - new Date(b.date).getTime()
      );
      
      if (sortedData.length < 2) return null;
      
      const firstReading = sortedData[0];
      const lastReading = sortedData[sortedData.length - 1];
      
      const timeDiffMs = new Date(lastReading.date).getTime() - new Date(firstReading.date).getTime();
      const timeDiffHours = timeDiffMs / (1000 * 60 * 60);
      
      if (timeDiffHours === 0) return null;
      
      const sgDiff = firstReading.value - lastReading.value;
      const ratePerHour = sgDiff / timeDiffHours;
      return ratePerHour * 24;
    }
    
    const firstReading = recentReadings[0];
    const lastReading = recentReadings[recentReadings.length - 1];
    
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

      const brewsData = brewReadings.map((reading: any) => {
        let sgData = reading.sg_data || [];
        
        if (reading.status === 'Conditioning' || reading.status === 'Completed') {
          const sortedData = [...sgData].sort((a, b) => 
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
          
          sgData = sortedData.slice(0, cutoffIndex + 1);
        }
        
        const fermentationRate = calculateFermentationRate(sgData);
        
        if (
          fermentationRate !== null && 
          Math.abs(fermentationRate) < 0.0005 &&
          !reading.coldcrash_acknowledged
        ) {
          sonnerToast(`${reading.name} är klar! 🍺`, {
            description: "Jäsningen är färdig (0.000/dag). Dags för Coldcrash!",
            duration: Infinity,
            action: {
              label: 'Kvittera',
              onClick: async () => {
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
          coldcrashAcknowledged: reading.coldcrash_acknowledged ?? false
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

  const loadPills = async () => {
    try {
      const { data: selectedPills, error: selectedError } = await supabase
        .from('selected_rapt_pills')
        .select('pill_id')
        .eq('is_visible', true)
        .order('display_order');

      if (selectedError) throw selectedError;

      if (!selectedPills || selectedPills.length === 0) {
        setPills([]);
        return;
      }

      const selectedPillIds = selectedPills.map(sp => sp.pill_id);

      const { data: pillData, error: pillError } = await supabase
        .from('rapt_pills')
        .select('*')
        .in('pill_id', selectedPillIds);

      if (pillError) throw pillError;

      setPills(pillData || []);
    } catch (error) {
      console.error('Error loading pills:', error);
    }
  };

  const loadControllers = async () => {
    try {
      const { data: selectedControllers, error: selectedError } = await supabase
        .from('selected_rapt_temp_controllers')
        .select('controller_id')
        .eq('is_visible', true)
        .order('display_order');

      if (selectedError) throw selectedError;

      if (!selectedControllers || selectedControllers.length === 0) {
        setControllers([]);
        return;
      }

      const selectedControllerIds = selectedControllers.map(sc => sc.controller_id);

      const { data: controllerData, error: controllerError } = await supabase
        .from('rapt_temp_controllers')
        .select('*')
        .in('controller_id', selectedControllerIds);

      if (controllerError) throw controllerError;

      setControllers(controllerData || []);
    } catch (error) {
      console.error('Error loading controllers:', error);
    }
  };

  // Realtime subscriptions
  useEffect(() => {
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
          if (payload.eventType === 'UPDATE') {
            const updatedReading = payload.new as any;
            
            setBrews(prevBrews => 
              prevBrews.map(brew => {
                if (brew.batch_id === updatedReading.batch_id) {
                  let newSgData = updatedReading.sg_data || [];
                  
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
                  
                  const newFermentationRate = calculateFermentationRate(newSgData);
                  
                  if (
                    newFermentationRate !== null && 
                    Math.abs(newFermentationRate) < 0.0005 &&
                    !brew.coldcrashAcknowledged
                  ) {
                    sonnerToast(`${updatedReading.name} är klar! 🍺`, {
                      description: "Jäsningen är färdig (0.000/dag). Dags för Coldcrash!",
                      duration: Infinity,
                      action: {
                        label: 'Kvittera',
                        onClick: async () => {
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
          } else {
            loadBrews();
          }
        }
      )
      .subscribe();

    const pillChannel = supabase
      .channel('rapt-pills-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rapt_pills'
        },
        () => {
          loadPills();
        }
      )
      .subscribe();

    const controllerChannel = supabase
      .channel('rapt-temp-controllers-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rapt_temp_controllers'
        },
        () => {
          loadControllers();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(brewChannel);
      supabase.removeChannel(pillChannel);
      supabase.removeChannel(controllerChannel);
    };
  }, []);

  const getTempColor = (temp: number): { hsl: string; rgb: string } => {
    const clampedTemp = Math.min(Math.max(temp, 0), 30);
    const hue = 200 - (clampedTemp / 30) * 200;
    return {
      hsl: `${hue} 80% 55%`,
      rgb: hslToRgb(hue, 0.8, 0.55)
    };
  };

  const getControllerColor = (name: string): string => {
    const lowerName = name.toLowerCase();
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
    
    return 'currentColor';
  };

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

  if (loading) {
    return (
      <div className="h-screen w-full bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
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

  const featuredBrew = brews[featuredBrewIndex];

  return (
    <div className="h-screen w-full bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <div className="h-16 flex items-center justify-between border-b border-border/50 backdrop-blur-sm bg-background/80 flex-shrink-0 px-6">
        <div className="relative">
          <h1 className="font-bold brewing-title text-3xl" style={{ 
            background: 'linear-gradient(135deg, hsl(38 90% 60%) 0%, hsl(45 95% 65%) 100%)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent'
          }}>
            Bryggövervakare
          </h1>
          {/* Bubbles */}
          <span className="absolute text-[0.3em] opacity-40" style={{ 
            left: '5%', 
            top: '20%',
            color: 'hsl(38 90% 60%)',
            animation: 'bubble-rise 4s infinite ease-in, bubble-float 2.5s infinite ease-in-out',
            animationDelay: '0.5s, 0.2s'
          }}>○</span>
          <span className="absolute text-[0.25em] opacity-40" style={{ 
            left: '35%', 
            top: '50%',
            color: 'hsl(45 95% 65%)',
            animation: 'bubble-rise 3.5s infinite ease-in, bubble-float 2s infinite ease-in-out',
            animationDelay: '2s, 1s'
          }}>○</span>
          <span className="absolute text-[0.35em] opacity-40" style={{ 
            left: '55%', 
            top: '15%',
            color: 'hsl(38 90% 60%)',
            animation: 'bubble-rise 3.8s infinite ease-in, bubble-float 2.2s infinite ease-in-out',
            animationDelay: '3s, 1.5s'
          }}>○</span>
          <span className="absolute text-[0.28em] opacity-40" style={{ 
            left: '88%', 
            top: '40%',
            color: 'hsl(45 95% 65%)',
            animation: 'bubble-rise 4.2s infinite ease-in, bubble-float 2.8s infinite ease-in-out',
            animationDelay: '1s, 0.5s'
          }}>○</span>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            {/* Temp Controllers */}
            {controllers.map((controller) => {
              const controllerColor = getControllerColor(controller.name);
              return (
                <div 
                  key={controller.id}
                  className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => {
                    setSelectedController(controller);
                    setControllerDialogOpen(true);
                  }}
                  title={`${controller.name}`}
                >
                  <AirVent style={{ width: 24, height: 24, color: controllerColor }} />
                  <span className="font-bold tabular-nums text-lg">
                    {controller.pill_temp !== null 
                      ? `${controller.pill_temp.toFixed(1)}°C` 
                      : controller.current_temp !== null 
                        ? `${controller.current_temp.toFixed(1)}°C` 
                        : '--°C'
                    }
                  </span>
                </div>
              );
            })}
            
            {/* Pills */}
            {pills.map((pill) => {
              const isPillStale = pill.last_update ? 
                ((new Date().getTime() - new Date(pill.last_update).getTime()) / (1000 * 60 * 60)) > 24 
                : true;
              
              return (
                <div 
                  key={pill.id}
                  className={`flex items-center gap-2 ${isPillStale ? 'opacity-50' : ''}`}
                  title={`${pill.name}\\nBatteri: ${pill.battery_level}%${isPillStale ? '\\n⚠️ Ingen uppdatering på >24h' : ''}`}
                >
                  <Pill style={{ width: 24, height: 24 }} color={pill.color} strokeWidth={2.5} />
                  <span 
                    className="font-bold tabular-nums text-lg" 
                    style={{ color: pill.battery_level > 50 ? 'rgb(34 197 94)' : pill.battery_level > 20 ? 'rgb(234 179 8)' : 'rgb(239 68 68)' }}
                  >
                    {pill.battery_level}%
                  </span>
                </div>
              );
            })}
          </div>
          
          <div className="flex flex-col items-center">
            <p className="font-semibold tabular-nums text-2xl">
              {currentTime.toLocaleTimeString("sv-SE", {
                hour: "2-digit",
                minute: "2-digit",
              })}:{currentTime.getSeconds().toString().padStart(2, '0')}
            </p>
            <p className="text-muted-foreground uppercase tracking-wider text-xs font-semibold">
              {currentTime.toLocaleDateString("sv-SE", {
                weekday: "short",
                day: "numeric",
                month: "short",
              })}
            </p>
          </div>
          
          <div className="relative">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/settings')}
              className="opacity-40 hover:opacity-100 transition-all"
            >
              <Settings className="h-6 w-6" />
            </Button>
            <SyncCountdown className="w-full h-full" />
          </div>
        </div>
      </div>

      {/* Split Screen Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Brew List */}
        <div className="w-1/4 border-r border-border/50 overflow-y-auto p-4 space-y-3">
          {brews.map((brew, index) => {
            const isFeatured = index === featuredBrewIndex;
            const tempColor = getTempColor(brew.currentTemp);
            
            return (
              <Card 
                key={brew.id}
                className={`p-4 cursor-pointer transition-all duration-300 ${
                  isFeatured 
                    ? 'ring-2 ring-primary shadow-lg shadow-primary/20 bg-primary/5' 
                    : 'hover:bg-accent/50'
                }`}
                onClick={() => setFeaturedBrewIndex(index)}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <h3 className="font-bold text-lg leading-tight mb-1">{brew.name}</h3>
                    <p className="text-xs text-muted-foreground">{brew.style}</p>
                  </div>
                  {brew.battery !== null && (
                    <div className="flex items-center gap-1">
                      <Battery 
                        className="h-4 w-4" 
                        style={{ 
                          color: brew.battery > 50 ? 'rgb(34 197 94)' : brew.battery > 20 ? 'rgb(234 179 8)' : 'rgb(239 68 68)' 
                        }} 
                      />
                      <span className="text-xs font-medium">{brew.battery}%</span>
                    </div>
                  )}
                </div>

                {/* Compact Stats */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-1">
                    <Droplets className="h-3 w-3 text-beer-amber" />
                    <span className="font-mono">{brew.currentSG.toFixed(3)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Thermometer className="h-3 w-3" style={{ color: tempColor.rgb }} />
                    <span className="font-mono">{brew.currentTemp.toFixed(1)}°C</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Activity className="h-3 w-3 text-ferment-green" />
                    <span className="font-mono">{brew.attenuation}%</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Wine className="h-3 w-3 text-primary" />
                    <span className="font-mono">{brew.abv.toFixed(1)}%</span>
                  </div>
                </div>

                {/* Mini progress bar */}
                <div className="mt-2">
                  <Progress value={brew.attenuation} className="h-1.5" />
                </div>
              </Card>
            );
          })}
        </div>

        {/* Right Panel - Featured Brew Detail */}
        <div className="flex-1 p-6 overflow-y-auto">
          <div className="h-full flex flex-col">
            {/* Featured Brew Header */}
            <div className="mb-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h2 className="text-4xl font-bold mb-1 bg-gradient-beer bg-clip-text text-transparent">
                    {featuredBrew.name}
                  </h2>
                  <p className="text-xl text-muted-foreground">{featuredBrew.style}</p>
                  <p className="text-sm text-muted-foreground mt-1">Batch #{featuredBrew.batchNumber}</p>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Timer className="h-4 w-4" />
                  <span>Uppdaterad: {featuredBrew.lastUpdate}</span>
                </div>
              </div>
              
              {/* Rotation indicator */}
              {brews.length > 1 && (
                <div className="flex gap-2 mt-3">
                  {brews.map((_, index) => (
                    <div
                      key={index}
                      className={`h-1 rounded-full flex-1 transition-all ${
                        index === featuredBrewIndex ? 'bg-primary' : 'bg-muted'
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Large Chart */}
            <div className="flex-1 mb-6">
              <Card className="h-full p-6 bg-gradient-card">
                <BrewChart
                  data={featuredBrew.sgData}
                  og={featuredBrew.originalGravity}
                  fg={featuredBrew.finalGravity}
                  singleView={true}
                />
              </Card>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-4 gap-4">
              <Card className="p-4 bg-gradient-to-br from-beer-amber/10 to-beer-gold/10 border-beer-amber/20">
                <div className="flex items-center gap-2 mb-2">
                  <Droplets className="h-5 w-5 text-beer-amber" />
                  <span className="text-sm font-medium text-muted-foreground">Specifik Vikt</span>
                </div>
                <p className="text-3xl font-bold font-mono">{featuredBrew.currentSG.toFixed(3)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  OG: {featuredBrew.originalGravity.toFixed(3)} → FG: {featuredBrew.finalGravity.toFixed(3)}
                </p>
              </Card>

              <Card className="p-4 bg-gradient-to-br from-temp-blue/10 to-accent/10 border-temp-blue/20">
                <div className="flex items-center gap-2 mb-2">
                  <Thermometer className="h-5 w-5" style={{ color: getTempColor(featuredBrew.currentTemp).rgb }} />
                  <span className="text-sm font-medium text-muted-foreground">Temperatur</span>
                </div>
                <p className="text-3xl font-bold font-mono">{featuredBrew.currentTemp.toFixed(1)}°C</p>
                <div className="flex items-center gap-1 mt-1">
                  <Waves className="h-3 w-3 text-temp-blue" />
                  <p className="text-xs text-muted-foreground">
                    {featuredBrew.fermentationRate !== null 
                      ? `${featuredBrew.fermentationRate >= 0 ? '+' : ''}${featuredBrew.fermentationRate.toFixed(3)}/dag` 
                      : 'N/A'}
                  </p>
                </div>
              </Card>

              <Card className="p-4 bg-gradient-to-br from-ferment-green/10 to-primary/10 border-ferment-green/20">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingDown className="h-5 w-5 text-ferment-green" />
                  <span className="text-sm font-medium text-muted-foreground">Utjäsning</span>
                </div>
                <p className="text-3xl font-bold font-mono">{featuredBrew.attenuation}%</p>
                <Progress value={featuredBrew.attenuation} className="mt-2 h-2" />
              </Card>

              <Card className="p-4 bg-gradient-to-br from-primary/10 to-secondary/10 border-primary/20">
                <div className="flex items-center gap-2 mb-2">
                  <Wine className="h-5 w-5 text-primary" />
                  <span className="text-sm font-medium text-muted-foreground">Alkohol</span>
                </div>
                <p className="text-3xl font-bold font-mono">{featuredBrew.abv.toFixed(1)}%</p>
                <div className="flex items-center gap-1 mt-1">
                  <Flame className="h-3 w-3 text-primary" />
                  <p className="text-xs text-muted-foreground">ABV</p>
                </div>
              </Card>
            </div>
          </div>
        </div>
      </div>

      <RaptControllerDialog
        controller={selectedController}
        open={controllerDialogOpen}
        onOpenChange={setControllerDialogOpen}
      />
    </div>
  );
}
