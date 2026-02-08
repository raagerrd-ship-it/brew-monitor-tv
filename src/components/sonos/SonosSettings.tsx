import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
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
  const [bgBlur, setBgBlur] = useState(40);
  const [bgBrightness, setBgBrightness] = useState(90);
  const [bgContrast, setBgContrast] = useState(1.0);
  const [bgSaturation, setBgSaturation] = useState(1.0);
  const [bgTopGradientOpacity, setBgTopGradientOpacity] = useState(0.45);
  const [bgTopGradientHeight, setBgTopGradientHeight] = useState(85);
  const [trackChangeOffset, setTrackChangeOffset] = useState(0);
  const [prefetchSeconds, setPrefetchSeconds] = useState(30);

  useEffect(() => {
    loadSonosStatus();
  }, []);

  const loadSonosStatus = async () => {
    setIsLoading(true);
    try {
      const [groupsResponse, settingsResult] = await Promise.all([
        fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sonos-groups`, {
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
        }),
        (supabase as any)
          .from('sonos_settings')
          .select('id, bg_blur, bg_brightness, bg_contrast, bg_saturation, bg_top_gradient_opacity, bg_top_gradient_height, show_on_dashboard, selected_group_id, selected_group_name, track_change_offset_seconds, prefetch_seconds')
          .limit(1)
          .maybeSingle(),
      ]);

      if (groupsResponse.ok) {
        const data = await groupsResponse.json();
        if (data?.connected) {
          setIsConnected(true);
          setGroups(data.groups || []);
        } else {
          setIsConnected(false);
        }
      } else {
        setIsConnected(false);
      }

      const settings = settingsResult.data;
      if (settings) {
        setSelectedGroupId(settings.selected_group_id);
        setShowOnDashboard(settings.show_on_dashboard ?? true);
        setBgBlur(settings.bg_blur ?? 40);
        setBgBrightness(settings.bg_brightness ?? 90);
        setBgContrast(settings.bg_contrast ?? 1.0);
        setBgSaturation(settings.bg_saturation ?? 1.0);
        setBgTopGradientOpacity(settings.bg_top_gradient_opacity ?? 0.45);
        setBgTopGradientHeight(settings.bg_top_gradient_height ?? 85);
        setTrackChangeOffset(settings.track_change_offset_seconds ?? 0);
        setPrefetchSeconds(settings.prefetch_seconds ?? 30);
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
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sonos-auth?action=start`,
        {
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
        }
      );
      const data = await response.json();
      
      if (data.authUrl) {
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
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sonos-auth?action=disconnect`,
        {
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
        }
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

  const [isRegenerating, setIsRegenerating] = useState(false);

  const saveAllSettings = async () => {
    try {
      const selectedGroup = groups.find(g => g.id === selectedGroupId);

      const settingsData = {
        selected_group_id: selectedGroupId,
        selected_group_name: selectedGroup?.name || null,
        show_on_dashboard: showOnDashboard,
        bg_blur: bgBlur,
        bg_brightness: bgBrightness,
        bg_contrast: bgContrast,
        bg_saturation: bgSaturation,
        bg_top_gradient_opacity: bgTopGradientOpacity,
        bg_top_gradient_height: bgTopGradientHeight,
        track_change_offset_seconds: trackChangeOffset,
        prefetch_seconds: prefetchSeconds,
      };

      const { data: existing } = await (supabase as any)
        .from('sonos_settings')
        .select('id')
        .limit(1)
        .maybeSingle();

      let error;
      if (existing) {
        ({ error } = await (supabase as any)
          .from('sonos_settings')
          .update(settingsData)
          .eq('id', existing.id));
      } else {
        ({ error } = await (supabase as any)
          .from('sonos_settings')
          .insert(settingsData));
      }

      if (error) {
        console.error('Failed to save sonos settings:', error);
        toast.error('Kunde inte spara: ' + error.message);
        return;
      }

      toast.success('Sonos-inställningar sparade');
    } catch (error) {
      console.error('Failed to save settings:', error);
      toast.error('Kunde inte spara inställningar');
    }
  };

  const saveAndRegenerate = async () => {
    setIsRegenerating(true);
    try {
      await saveAllSettings();
      // Trigger server sync to regenerate background with new settings
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-sonos-now-playing`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          'Content-Type': 'application/json',
        },
      });
      toast.success('Bakgrundsbild genereras om med nya inställningar');
    } catch (error) {
      console.error('Failed to regenerate background:', error);
      toast.error('Kunde inte generera om bakgrundsbild');
    } finally {
      setIsRegenerating(false);
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
          {/* General Sonos Settings */}
          <div className="space-y-4 p-4 rounded-lg border">
            <h4 className="text-sm font-medium">Allmänna inställningar</h4>

            {/* Group Selection */}
            <div className="space-y-2">
              <Label htmlFor="sonos-group">Rum att visa</Label>
              <Select value={selectedGroupId || ''} onValueChange={setSelectedGroupId}>
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
            <div className="flex items-center justify-between py-2">
              <div>
                <Label htmlFor="show-on-dashboard">Visa på dashboard</Label>
                <p className="text-sm text-muted-foreground">
                  Visa "Nu spelas" i headern
                </p>
              </div>
              <Switch
                id="show-on-dashboard"
                checked={showOnDashboard}
                onCheckedChange={setShowOnDashboard}
              />
            </div>
          </div>

          {/* Playback / Widget Settings */}
          <div className="space-y-4 p-4 rounded-lg border">
            <h4 className="text-sm font-medium">Uppspelning & widget</h4>

            {/* Track Change Offset */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Synk-justering vid låtbyte</Label>
                <span className="text-sm text-muted-foreground tabular-nums">{trackChangeOffset.toFixed(1)}s</span>
              </div>
              <Slider
                value={[trackChangeOffset]}
                min={0}
                max={4}
                step={0.1}
                onValueChange={(v) => setTrackChangeOffset(Math.round(v[0] * 10) / 10)}
              />
              <p className="text-xs text-muted-foreground">
                Sekunder innan beräknat låtslut som bild och bakgrund byter till nästa låt
              </p>
            </div>

            {/* Prefetch Threshold */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Förladdning av albumomslag</Label>
                <span className="text-sm text-muted-foreground tabular-nums">{prefetchSeconds}s</span>
              </div>
              <Slider
                value={[prefetchSeconds]}
                min={10}
                max={60}
                step={5}
                onValueChange={(v) => setPrefetchSeconds(v[0])}
              />
              <p className="text-xs text-muted-foreground">
                Hur långt innan låtslut som nästa låts omslag och bakgrund förladdas
              </p>
            </div>
          </div>

          {/* Background Image Processing Section */}
          <div className="space-y-4 p-4 rounded-lg border">
            <div className="space-y-1">
              <h4 className="text-sm font-medium">Bakgrundsbildbehandling (TV-läge)</h4>
              <p className="text-xs text-muted-foreground">
                Dessa inställningar styr hur albumomslaget bearbetas till bakgrundsbild
              </p>
            </div>

            {/* Background Blur */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Oskärpa</Label>
                <span className="text-sm text-muted-foreground tabular-nums">{bgBlur}px</span>
              </div>
              <Slider
                value={[bgBlur]}
                min={0}
                max={200}
                step={1}
                onValueChange={(v) => setBgBlur(v[0])}
              />
            </div>

            {/* Background Brightness (target luminance) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Ljusstyrka (mål-luminans)</Label>
                <span className="text-sm text-muted-foreground tabular-nums">{Math.round(bgBrightness)}</span>
              </div>
              <Slider
                value={[bgBrightness]}
                min={10}
                max={255}
                step={5}
                onValueChange={(v) => setBgBrightness(v[0])}
              />
              <p className="text-xs text-muted-foreground">
                Normaliserad ljusstyrka — alla bilder når samma ljusnivå oavsett original. Rekommenderat ~70-100
              </p>
            </div>


            {/* Top Gradient Opacity */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Överkantsmörkläggning</Label>
                <span className="text-sm text-muted-foreground tabular-nums">{Math.round(bgTopGradientOpacity * 100)}%</span>
              </div>
              <Slider
                value={[bgTopGradientOpacity]}
                min={0}
                max={1.0}
                step={0.05}
                onValueChange={(v) => setBgTopGradientOpacity(v[0])}
              />
              <p className="text-xs text-muted-foreground">
                Mörkare överkant för bättre läsbarhet av headern
              </p>
            </div>

            {/* Top Gradient Height */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Överkantshöjd</Label>
                <span className="text-sm text-muted-foreground tabular-nums">{bgTopGradientHeight}px</span>
              </div>
              <Slider
                value={[bgTopGradientHeight]}
                min={0}
                max={200}
                step={5}
                onValueChange={(v) => setBgTopGradientHeight(v[0])}
              />
            </div>

            <Button onClick={saveAndRegenerate} disabled={isRegenerating} className="w-full">
              {isRegenerating ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Spara & generera om bakgrund
            </Button>
          </div>

          {/* Save all */}
          <Button onClick={saveAllSettings} variant="outline" className="w-full">
            Spara alla inställningar
          </Button>
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
