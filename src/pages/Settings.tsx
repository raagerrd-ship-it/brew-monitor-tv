import { BrewManagement } from "@/components/BrewManagement";
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
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [autoHideCompleted, setAutoHideCompleted] = useState(true);
  const [autoHideConditioning, setAutoHideConditioning] = useState(true);
  const [autoActivateFermenting, setAutoActivateFermenting] = useState(true);
  const [fullSyncInterval, setFullSyncInterval] = useState<string>("86400");

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

      if (data) {
        setSettingsId(data.id);
        setSyncInterval(data.sync_interval.toString());
        setAutoHideCompleted(data.auto_hide_completed ?? true);
        setAutoHideConditioning(data.auto_hide_conditioning ?? true);
        setAutoActivateFermenting(data.auto_activate_fermenting ?? true);
        setFullSyncInterval(data.full_sync_interval?.toString() ?? "86400");
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
          <h2 className="text-xl font-bold mb-4">Synkroniseringsinställningar</h2>
          
          <div className="space-y-4">
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
              <p className="text-xs text-muted-foreground mt-2">
                Snabb synkronisering uppdaterar bara avläsningar
              </p>
            </div>

            <div className="space-y-4 border-t pt-4">
              <h3 className="text-sm font-medium">Full synkronisering</h3>
              
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
                <p className="text-xs text-muted-foreground mt-2">
                  Full synkronisering hämtar alla detaljer inklusive OG från Brewfather
                </p>
              </div>

              <div className="space-y-3">
                <h4 className="text-sm font-medium">Automatisk hantering</h4>
              
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
                  Ta bort öl som är klara
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
                  Ta bort öl som konditioneras
                </label>
              </div>

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
                  Aktivera automatiskt nya öl (med status jäsning)
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
                  {syncing ? 'Synkroniserar...' : 'Full synkronisering'}
                </Button>
                <p className="text-xs text-muted-foreground mt-2">
                  Kör en manuell full synkronisering nu
                </p>
              </div>
            </div>
          </div>
        </Card>

        <BrewManagement />
      </div>
    </div>
  );
}
