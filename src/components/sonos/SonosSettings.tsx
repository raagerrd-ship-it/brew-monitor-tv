import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Music, ExternalLink, Unlink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface SonosGroup {
  id: string;
  name: string;
  householdId: string;
}

export function SonosSettings() {
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [groups, setGroups] = useState<SonosGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [showOnDashboard, setShowOnDashboard] = useState(true);

  useEffect(() => {
    loadSonosStatus();
  }, []);

  const loadSonosStatus = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(
        `https://plwchuzidrjgyuepwdcl.supabase.co/functions/v1/sonos-groups`
      );
      
      if (response.ok) {
        const data = await response.json();
        if (data?.connected) {
          setIsConnected(true);
          setGroups(data.groups || []);
          setSelectedGroupId(data.selectedGroupId);
          setShowOnDashboard(data.showOnDashboard ?? true);
        } else {
          setIsConnected(false);
        }
      } else {
        setIsConnected(false);
      }
    } catch (error) {
      console.error('Failed to load Sonos status:', error);
      setIsConnected(false);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      const response = await supabase.functions.invoke('sonos-auth', {
        body: null,
      });

      // Get the auth URL with action=start
      const startResponse = await fetch(
        `https://plwchuzidrjgyuepwdcl.supabase.co/functions/v1/sonos-auth?action=start`
      );
      const data = await startResponse.json();
      
      if (data.authUrl) {
        // Redirect to Sonos OAuth
        window.location.href = data.authUrl;
      } else {
        toast.error('Kunde inte starta Sonos-koppling');
      }
    } catch (error) {
      console.error('Failed to start Sonos connection:', error);
      toast.error('Ett fel uppstod vid anslutning till Sonos');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await fetch(
        `https://plwchuzidrjgyuepwdcl.supabase.co/functions/v1/sonos-auth?action=disconnect`
      );
      setIsConnected(false);
      setGroups([]);
      setSelectedGroupId(null);
      toast.success('Sonos-konto bortkopplat');
    } catch (error) {
      console.error('Failed to disconnect Sonos:', error);
      toast.error('Kunde inte koppla bort Sonos');
    }
  };

  const handleGroupChange = async (groupId: string) => {
    setSelectedGroupId(groupId);
    const selectedGroup = groups.find(g => g.id === groupId);
    
    try {
      // Update settings in database using any type
      const { data: existingSettings } = await (supabase as any)
        .from('sonos_settings')
        .select('id')
        .limit(1)
        .maybeSingle();

      if (existingSettings) {
        await (supabase as any)
          .from('sonos_settings')
          .update({
            selected_group_id: groupId,
            selected_group_name: selectedGroup?.name,
          })
          .eq('id', existingSettings.id);
      } else {
        await (supabase as any).from('sonos_settings').insert({
          selected_group_id: groupId,
          selected_group_name: selectedGroup?.name,
        });
      }

      toast.success(`Valt rum: ${selectedGroup?.name}`);
    } catch (error) {
      console.error('Failed to update group:', error);
      toast.error('Kunde inte uppdatera valt rum');
    }
  };

  const handleShowOnDashboardChange = async (checked: boolean) => {
    setShowOnDashboard(checked);
    
    try {
      const { data: existingSettings } = await (supabase as any)
        .from('sonos_settings')
        .select('id')
        .limit(1)
        .maybeSingle();

      if (existingSettings) {
        await (supabase as any)
          .from('sonos_settings')
          .update({ show_on_dashboard: checked })
          .eq('id', existingSettings.id);
      }
    } catch (error) {
      console.error('Failed to update show on dashboard:', error);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Connection Status */}
      <div className="flex items-center justify-between p-4 rounded-lg border bg-card">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-full ${isConnected ? 'bg-primary/10' : 'bg-muted'}`}>
            <Music className={`h-5 w-5 ${isConnected ? 'text-primary' : 'text-muted-foreground'}`} />
          </div>
          <div>
            <p className="font-medium">Sonos</p>
            <p className="text-sm text-muted-foreground">
              {isConnected ? 'Kopplat' : 'Inte kopplat'}
            </p>
          </div>
        </div>
        
        {isConnected ? (
          <Button variant="outline" size="sm" onClick={handleDisconnect}>
            <Unlink className="h-4 w-4 mr-2" />
            Koppla bort
          </Button>
        ) : (
          <Button onClick={handleConnect} disabled={isConnecting}>
            {isConnecting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <ExternalLink className="h-4 w-4 mr-2" />
            )}
            Koppla Sonos
          </Button>
        )}
      </div>

      {/* Settings (only show when connected) */}
      {isConnected && (
        <>
          {/* Group Selection */}
          <div className="space-y-2">
            <Label htmlFor="sonos-group">Rum att visa</Label>
            <Select value={selectedGroupId || ''} onValueChange={handleGroupChange}>
              <SelectTrigger id="sonos-group">
                <SelectValue placeholder="Välj rum..." />
              </SelectTrigger>
              <SelectContent>
                {groups.map(group => (
                  <SelectItem key={group.id} value={group.id}>
                    {group.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Visa vad som spelas i det valda rummet
            </p>
          </div>

          {/* Show on Dashboard Toggle */}
          <div className="flex items-center justify-between p-4 rounded-lg border">
            <div>
              <Label htmlFor="show-on-dashboard">Visa på dashboard</Label>
              <p className="text-sm text-muted-foreground">
                Visa "Nu spelas" i headern
              </p>
            </div>
            <Switch
              id="show-on-dashboard"
              checked={showOnDashboard}
              onCheckedChange={handleShowOnDashboardChange}
            />
          </div>
        </>
      )}

      {/* Help text */}
      {!isConnected && (
        <p className="text-sm text-muted-foreground">
          Koppla ditt Sonos-konto för att visa vad som spelas i headern på dashboarden.
          Du behöver vara inloggad som testanvändare i Sonos Developer Portal för att 
          OAuth ska fungera i sandbox-läge.
        </p>
      )}
    </div>
  );
}
