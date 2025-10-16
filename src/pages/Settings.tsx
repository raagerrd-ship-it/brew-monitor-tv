import { BrewManagement } from "@/components/BrewManagement";
import { RaptPillsList } from "@/components/RaptPillsList";
import { RaptPillsManagement } from "@/components/RaptPillsManagement";
import { RaptControllersManagement } from "@/components/RaptControllersManagement";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export default function Settings() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [syncInterval, setSyncInterval] = useState<string>("60");
  const [syncing, setSyncing] = useState(false);
  const [quickSyncing, setQuickSyncing] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [autoHideCompleted, setAutoHideCompleted] = useState(true);
  const [autoHideConditioning, setAutoHideConditioning] = useState(true);
  const [autoActivateFermenting, setAutoActivateFermenting] = useState(true);
  const [fullSyncInterval, setFullSyncInterval] = useState<string>("86400");
  const [raptSyncing, setRaptSyncing] = useState(false);
  const [lastRaptSync, setLastRaptSync] = useState<string | null>(null);
  const [raptSyncInterval, setRaptSyncInterval] = useState<string>("900");

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('sync_settings')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      console.log('Settings loaded:', data);

      if (data) {
        setSettingsId(data.id);
        setSyncInterval(data.sync_interval.toString());
        setAutoHideCompleted(data.auto_hide_completed ?? true);
        setAutoHideConditioning(data.auto_hide_conditioning ?? true);
        setAutoActivateFermenting(data.auto_activate_fermenting ?? true);
        setFullSyncInterval(data.full_sync_interval?.toString() ?? "86400");
        setLastRaptSync(data.last_rapt_sync_at);
        setRaptSyncInterval(data.rapt_sync_interval?.toString() ?? "900");
        console.log('Last RAPT sync:', data.last_rapt_sync_at);
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const handleSyncIntervalChange = async (value: string) => {
    setSyncInterval(value);
    
    try {
      if (settingsId) {
        const { error } = await supabase
          .from('sync_settings')
          .update({ sync_interval: parseInt(value) })
          .eq('id', settingsId);

        if (error) throw error;

        toast({
          title: "Inställningar sparade",
          description: "Synkroniseringsfrekvensen har uppdaterats",
        });
      }
    } catch (error) {
      console.error('Error updating settings:', error);
      toast({
        title: "Fel",
        description: "Kunde inte spara inställningar",
        variant: "destructive",
      });
    }
  };

  const handleFullSyncIntervalChange = async (value: string) => {
    setFullSyncInterval(value);
    
    try {
      if (settingsId) {
        const { error } = await supabase
          .from('sync_settings')
          .update({ full_sync_interval: parseInt(value) })
          .eq('id', settingsId);

        if (error) throw error;

        toast({
          title: "Inställningar sparade",
          description: "Full synkroniseringsfrekvens har uppdaterats",
        });
      }
    } catch (error) {
      console.error('Error updating full sync interval:', error);
      toast({
        title: "Fel",
        description: "Kunde inte spara inställningar",
        variant: "destructive",
      });
    }
  };

  const handleAutoSettingChange = async (field: string, value: boolean) => {
    try {
      if (settingsId) {
        const { error } = await supabase
          .from('sync_settings')
          .update({ [field]: value })
          .eq('id', settingsId);

        if (error) throw error;

        switch (field) {
          case 'auto_hide_completed':
            setAutoHideCompleted(value);
            break;
          case 'auto_hide_conditioning':
            setAutoHideConditioning(value);
            break;
          case 'auto_activate_fermenting':
            setAutoActivateFermenting(value);
            break;
        }

        toast({
          title: "Inställningar sparade",
          description: "Automatiseringsinställningarna har uppdaterats",
        });
      }
    } catch (error) {
      console.error('Error updating auto settings:', error);
      toast({
        title: "Fel",
        description: "Kunde inte spara inställningar",
        variant: "destructive",
      });
    }
  };

  const handleQuickSync = async () => {
    setQuickSyncing(true);
    try {
      const { error } = await supabase.functions.invoke('sync-brew-data', {
        body: {}
      });

      if (error) throw error;

      toast({
        title: "Synkronisering klar",
        description: "Snabb synkronisering har genomförts",
      });
    } catch (error) {
      console.error('Error during quick sync:', error);
      toast({
        title: "Fel",
        description: "Kunde inte genomföra synkronisering",
        variant: "destructive",
      });
    } finally {
      setQuickSyncing(false);
    }
  };

  const handleFullSync = async () => {
    setSyncing(true);
    try {
      const { error } = await supabase.functions.invoke('full-sync-brew-data', {
        body: {}
      });

      if (error) throw error;

      toast({
        title: "Synkronisering klar",
        description: "Full synkronisering har genomförts",
      });
    } catch (error) {
      console.error('Error during full sync:', error);
      toast({
        title: "Fel",
        description: "Kunde inte genomföra synkronisering",
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleRaptSyncIntervalChange = async (value: string) => {
    setRaptSyncInterval(value);
    
    try {
      if (settingsId) {
        const { error } = await supabase
          .from('sync_settings')
          .update({ rapt_sync_interval: parseInt(value) })
          .eq('id', settingsId);

        if (error) throw error;

        toast({
          title: "Inställningar sparade",
          description: "RAPT synkroniseringsfrekvens har uppdaterats",
        });
      }
    } catch (error) {
      console.error('Error updating RAPT sync interval:', error);
      toast({
        title: "Fel",
        description: "Kunde inte spara inställningar",
        variant: "destructive",
      });
    }
  };

  const handleRaptSync = async () => {
    setRaptSyncing(true);
    try {
      const { error } = await supabase.functions.invoke('sync-rapt-data', {
        body: {}
      });

      if (error) throw error;

      toast({
        title: "RAPT synkronisering klar",
        description: "Pills batterinivåer har uppdaterats",
      });
      
      // Reload settings to get updated timestamp
      await loadSettings();
    } catch (error) {
      console.error('Error during RAPT sync:', error);
      toast({
        title: "Fel",
        description: "Kunde inte synkronisera RAPT data",
        variant: "destructive",
      });
    } finally {
      setRaptSyncing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      <div className="container mx-auto max-w-4xl">
        <div className="py-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/")}
            className="mb-4"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Tillbaka till Dashboard
          </Button>
        </div>
        
        <Card className="p-6 mb-6">
          <h2 className="text-xl font-bold mb-6">Synkroniseringsinställningar</h2>
          
          <div className="space-y-8">
            <div className="space-y-4 pb-6 border-b">
              <div>
                <h3 className="text-lg font-semibold mb-1">Snabb synkronisering</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Uppdaterar löpande data för synliga öl
                </p>
                <div className="text-xs text-muted-foreground space-y-1 mb-4 pl-4">
                  <p>• Aktuellt SG (Specific Gravity)</p>
                  <p>• Aktuell temperatur</p>
                  <p>• Batterinivå</p>
                  <p>• Senaste avläsningstidpunkt</p>
                </div>
              </div>
              
              <div>
              <label className="text-sm font-medium mb-2 block">Synkroniseringsfrekvens</label>
              <Select value={syncInterval} onValueChange={handleSyncIntervalChange}>
                <SelectTrigger className="w-full bg-card">
                  <SelectValue placeholder="Välj frekvens" />
                </SelectTrigger>
                <SelectContent className="bg-card border-border z-50">
                  <SelectItem value="60">Varje minut</SelectItem>
                  <SelectItem value="300">Var 5:e minut</SelectItem>
                  <SelectItem value="600">Var 10:e minut</SelectItem>
                  <SelectItem value="900">Var 15:e minut</SelectItem>
                  <SelectItem value="3600">Varje timme</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Button
                onClick={handleQuickSync} 
                disabled={quickSyncing}
                className="w-full"
                variant="outline"
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${quickSyncing ? 'animate-spin' : ''}`} />
                {quickSyncing ? 'Synkroniserar...' : 'Kör snabb synkronisering nu'}
              </Button>
            </div>
            </div>

            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold mb-1">Full synkronisering</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Hämtar komplett data och hanterar automatisk synlighet av öl
                </p>
                <div className="text-xs text-muted-foreground space-y-1 mb-4 pl-4">
                  <p>• Receptinformation (namn, stil, batchnummer)</p>
                  <p>• OG (Original Gravity) och FG (Final Gravity)</p>
                  <p>• Status (jäsning, konditionering, klar)</p>
                  <p>• Alla historiska avläsningar (SG, temperatur, batteri)</p>
                  <p>• Automatisk synlighetshantering baserat på status</p>
                </div>
              </div>
              
              <div>
              <label className="text-sm font-medium mb-2 block">Frekvens</label>
                <Select value={fullSyncInterval} onValueChange={handleFullSyncIntervalChange}>
                  <SelectTrigger className="w-full bg-card">
                    <SelectValue placeholder="Välj frekvens" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border z-50">
                    <SelectItem value="3600">Varje timme</SelectItem>
                    <SelectItem value="21600">Var 6:e timme</SelectItem>
                    <SelectItem value="43200">Var 12:e timme</SelectItem>
                    <SelectItem value="86400">Varje dag</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3">
              <h4 className="text-sm font-medium">Automatisk hantering</h4>
              
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="auto-activate-fermenting"
                  checked={autoActivateFermenting}
                  onCheckedChange={(checked) => handleAutoSettingChange('auto_activate_fermenting', !!checked)}
                />
                <label
                  htmlFor="auto-activate-fermenting"
                  className="text-sm cursor-pointer leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Visa nya öl med status Jäsning
                </label>
              </div>
              
              
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="auto-hide-completed"
                  checked={autoHideCompleted}
                  onCheckedChange={(checked) => handleAutoSettingChange('auto_hide_completed', !!checked)}
                />
                <label
                  htmlFor="auto-hide-completed"
                  className="text-sm cursor-pointer leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Dölj öl som är klara
                </label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="auto-hide-conditioning"
                  checked={autoHideConditioning}
                  onCheckedChange={(checked) => handleAutoSettingChange('auto_hide_conditioning', !!checked)}
                />
                <label
                  htmlFor="auto-hide-conditioning"
                  className="text-sm cursor-pointer leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Dölj öl som konditioneras
                </label>
              </div>
            </div>

              <div>
                <Button 
                  onClick={handleFullSync} 
                  disabled={syncing}
                  className="w-full"
                >
                  <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
                  {syncing ? 'Synkroniserar...' : 'Kör full synkronisering nu'}
                </Button>
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-6 mb-6">
          <h2 className="text-xl font-bold mb-6">RAPT Inställningar</h2>
          
          <div className="space-y-6">
            <div>
              <p className="text-sm text-muted-foreground mb-4">
                Hantera dina RAPT Pills och Temperature Controllers
              </p>
              <div className="text-xs text-muted-foreground space-y-1 mb-4 pl-4">
                <p>• Synkroniserar batterinivåer och temperaturer</p>
                <p>• Välj vilka enheter som ska visas på dashboarden</p>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Synkroniseringsfrekvens</label>
              <Select value={raptSyncInterval} onValueChange={handleRaptSyncIntervalChange}>
                <SelectTrigger className="w-full bg-card">
                  <SelectValue placeholder="Välj frekvens" />
                </SelectTrigger>
                <SelectContent className="bg-card border-border z-50">
                  <SelectItem value="60">Varje minut</SelectItem>
                  <SelectItem value="300">Var 5:e minut</SelectItem>
                  <SelectItem value="600">Var 10:e minut</SelectItem>
                  <SelectItem value="900">Var 15:e minut</SelectItem>
                  <SelectItem value="1800">Var 30:e minut</SelectItem>
                  <SelectItem value="3600">Varje timme</SelectItem>
                </SelectContent>
              </Select>
            </div>
              
            {lastRaptSync ? (
              <p className="text-sm text-muted-foreground">
                Senaste synkning:{" "}
                <span className="font-medium text-foreground">
                  {new Date(lastRaptSync).toLocaleString("sv-SE", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                Ingen synkning har gjorts än
              </p>
            )}

            <div>
              <Button
                onClick={handleRaptSync} 
                disabled={raptSyncing}
                className="w-full"
                variant="outline"
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${raptSyncing ? 'animate-spin' : ''}`} />
                {raptSyncing ? 'Synkroniserar...' : 'Kör RAPT synkronisering nu'}
              </Button>
            </div>

            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold mb-4">RAPT Pills</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Välj vilka Pills som ska visas på dashboarden
              </p>
              <RaptPillsManagement />
            </div>

            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold mb-4">Temperature Controllers</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Välj vilka Temperature Controllers som ska visas på dashboarden
              </p>
              <RaptControllersManagement />
            </div>
          </div>
        </Card>

        <BrewManagement />
      </div>
    </div>
  );
}
