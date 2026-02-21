import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Loader2, Music, ExternalLink, Unlink, RefreshCw } from "lucide-react";
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
  const [isLoadingGroups, setIsLoadingGroups] = useState(false);
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
  
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [initialLoadDone, setInitialLoadDone] = useState(false);

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
          .select('id, bg_blur, bg_brightness, bg_contrast, bg_saturation, bg_top_gradient_opacity, bg_top_gradient_height, show_on_dashboard, selected_group_id, selected_group_name, track_change_offset_seconds')
          .limit(1)
          .maybeSingle(),
      ]);

      if (groupsResponse.ok) {
        const data = await groupsResponse.json();
        if (data?.connected) {
          setIsConnected(true);
          setGroups(data.groups || []);
        }
      }

      const settings = settingsResult.data;
      if (settings) {
        if (!isConnected && settings.selected_group_id) {
          setIsConnected(true);
        }
        setSettingsId(settings.id);
        setSelectedGroupId(settings.selected_group_id);
        setShowOnDashboard(settings.show_on_dashboard ?? true);
        setBgBlur(settings.bg_blur ?? 40);
        setBgBrightness(settings.bg_brightness ?? 90);
        setBgContrast(settings.bg_contrast ?? 1.0);
        setBgSaturation(settings.bg_saturation ?? 1.0);
        setBgTopGradientOpacity(settings.bg_top_gradient_opacity ?? 0.45);
        setBgTopGradientHeight(settings.bg_top_gradient_height ?? 85);
        setTrackChangeOffset(settings.track_change_offset_seconds ?? 0);
        
      } else if (!isConnected) {
        setIsConnected(false);
      }
    } catch (error) {
      console.error('Failed to load Sonos status:', error);
      setIsConnected(false);
    } finally {
      setIsLoading(false);
      setInitialLoadDone(true);
    }
  };

  /** Persist a partial settings update immediately */
  const saveField = useCallback(async (fields: Record<string, any>) => {
    try {
      if (settingsId) {
        await (supabase as any)
          .from('sonos_settings')
          .update(fields)
          .eq('id', settingsId);
      } else {
        const { data } = await (supabase as any)
          .from('sonos_settings')
          .insert(fields)
          .select('id')
          .single();
        if (data) setSettingsId(data.id);
      }
    } catch (error) {
      console.error('Failed to auto-save setting:', error);
    }
  }, [settingsId]);

  // Auto-save helpers for individual fields
  const handleGroupChange = (value: string) => {
    setSelectedGroupId(value);
    const selectedGroup = groups.find(g => g.id === value);
    saveField({ selected_group_id: value, selected_group_name: selectedGroup?.name || null });
  };

  const handleShowOnDashboardChange = (value: boolean) => {
    setShowOnDashboard(value);
    saveField({ show_on_dashboard: value });
  };

  const handleTrackChangeOffsetCommit = (value: number) => {
    setTrackChangeOffset(value);
    saveField({ track_change_offset_seconds: value });
  };


  const loadGroups = async () => {
    setIsLoadingGroups(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sonos-groups`, {
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
      });
      if (response.ok) {
        const data = await response.json();
        if (data?.connected) {
          setIsConnected(true);
          setGroups(data.groups || []);
          if (data.groups?.length > 0) {
            toast.success(`${data.groups.length} rum hittades`);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load groups:', error);
      toast.error('Kunde inte hämta rum');
    } finally {
      setIsLoadingGroups(false);
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

  const saveAndRegenerate = async () => {
    setIsRegenerating(true);
    try {
      // Save only background-related fields
      const bgFields = {
        bg_blur: bgBlur,
        bg_brightness: bgBrightness,
        bg_contrast: bgContrast,
        bg_saturation: bgSaturation,
        bg_top_gradient_opacity: bgTopGradientOpacity,
        bg_top_gradient_height: bgTopGradientHeight,
      };

      if (settingsId) {
        await (supabase as any)
          .from('sonos_settings')
          .update(bgFields)
          .eq('id', settingsId);
      } else {
        const { data } = await (supabase as any)
          .from('sonos_settings')
          .insert(bgFields)
          .select('id')
          .single();
        if (data) setSettingsId(data.id);
      }

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
          <Button variant="outline" size="sm" onClick={handleConnect} disabled={isConnecting}>
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
          <div className="space-y-4 p-4 rounded-lg border border-border/60 bg-muted/20">
            <p className="settings-label">Allmänna inställningar</p>

            {/* Group Selection */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="sonos-group">Rum att visa</Label>
                {groups.length === 0 && (
                  <Button variant="outline" size="sm" onClick={loadGroups} disabled={isLoadingGroups}>
                    {isLoadingGroups ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    <span className="ml-1.5 text-xs">Hämta rum</span>
                  </Button>
                )}
              </div>
              <Select value={selectedGroupId || ''} onValueChange={handleGroupChange}>
                <SelectTrigger id="sonos-group">
                  <SelectValue placeholder={groups.length === 0 ? "Inga rum hittade – tryck Hämta rum" : "Välj rum..."} />
                </SelectTrigger>
                <SelectContent className="bg-card border-border z-50">
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
                onCheckedChange={handleShowOnDashboardChange}
              />
            </div>
          </div>

          {/* Playback / Widget Settings */}
          <div className="space-y-4 p-4 rounded-lg border border-border/60 bg-muted/20">
            <p className="settings-label">Uppspelning & widget</p>

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
                onValueCommit={(v) => handleTrackChangeOffsetCommit(Math.round(v[0] * 10) / 10)}
              />
              <p className="text-xs text-muted-foreground">
                Sekunder innan beräknat låtslut som bild och bakgrund byter till nästa låt
              </p>
            </div>

          </div>

          {/* Background Image Processing Section */}
          <div className="space-y-4 p-4 rounded-lg border border-border/60 bg-muted/20">
            <div className="space-y-1">
              <p className="settings-label">Bakgrundsbildbehandling (TV-läge)</p>
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

            {/* Background Brightness */}
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

            <Button onClick={saveAndRegenerate} disabled={isRegenerating} variant="outline" size="sm" className="w-full">
              {isRegenerating ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Spara & generera om bakgrund
            </Button>
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
