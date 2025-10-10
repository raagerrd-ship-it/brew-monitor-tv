import { BrewManagement } from "@/components/BrewManagement";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
                Full synkronisering hämtar alla detaljer inklusive OG från Brewfather
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="text-xl font-bold mb-4">Hantera Öl</h2>
          <BrewManagement />
        </Card>
      </div>
    </div>
  );
}
