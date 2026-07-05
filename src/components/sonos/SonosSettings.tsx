import { useState, useEffect, useCallback } from "react";
import { useAlbumArt } from "@/contexts/AlbumArtContext";
import { getTvDebugEntries, subscribeTvDebug, type TvDebugEntry } from "@/lib/tv-debug-log";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Loader2, RefreshCw, ChevronDown, CheckCircle2, XCircle, Radio, Wifi, WifiOff, Copy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";


function BridgeEndpoints() {
  const baseUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
  const stateUrl = `${baseUrl}/sonos-bridge-push`;
  const positionUrl = `${baseUrl}/sonos-position`;

  const copy = async (url: string, label: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(`${label} kopierad`);
    } catch {
      toast.error('Kunde inte kopiera');
    }
  };

  return (
    <div className="space-y-3 p-4 rounded-lg border border-border/60 bg-muted/20">
      <div className="space-y-0.5">
        <p className="settings-label">Bridge endpoints</p>
        <p className="text-xs text-muted-foreground">
          URL:er för Cast Away-bridgen att posta data till. Använd shared secret <code className="text-foreground">SONOS_BRIDGE_SECRET</code> i headern <code className="text-foreground">x-bridge-secret</code>.
        </p>
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">State endpoint (full payload — låtbyten, volym, palette)</Label>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-[11px] font-mono text-foreground break-all select-all bg-background/60 border border-border/40 px-2 py-1.5 rounded">
            {stateUrl}
          </code>
          <Button variant="outline" size="icon" className="h-8 w-8 flex-shrink-0" onClick={() => copy(stateUrl, 'State URL')}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Position endpoint (lättviktiga 1s-ticks)</Label>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-[11px] font-mono text-foreground break-all select-all bg-background/60 border border-border/40 px-2 py-1.5 rounded">
            {positionUrl}
          </code>
          <Button variant="outline" size="icon" className="h-8 w-8 flex-shrink-0" onClick={() => copy(positionUrl, 'Position URL')}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}


function BridgeDiagnostics() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data: row } = await supabase
        .from('sonos_now_playing')
        .select('track_name, artist_name, album_name, playback_state, volume, mute, bass, treble, loudness, crossfade, media_type, track_number, nr_tracks, track_uri, duration_ms, position_ms, track_seq, updated_at, album_art_url, album_art_url_small, bg_image_url, next_track_name, next_artist_name, next_bg_image_url')
        .limit(1)
        .single();
      setData(row);
    } catch (e) {
      console.error('Bridge diagnostics error:', e);
    } finally {
      setLoading(false);
    }
  };

  const isRecent = (updatedAt: string | null) => {
    if (!updatedAt) return false;
    return Date.now() - new Date(updatedAt).getTime() < 120_000; // 2 min
  };

  const isBridgeArt = (url: string | null) => url?.includes('sonos-backgrounds/') ?? false;

  const formatMs = (ms: number | null) => {
    if (!ms) return '—';
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  return (
    <Collapsible>
      <div className="p-4 rounded-lg border border-border/60 bg-muted/20">
        <CollapsibleTrigger className="flex items-center justify-between w-full group">
          <div className="space-y-0.5 text-left">
            <p className="settings-label flex items-center gap-2">
              Bridge-status (lokal push)
              {data && (
                isRecent(data.updated_at)
                  ? <Wifi className="h-3.5 w-3.5 text-primary" />
                  : <WifiOff className="h-3.5 w-3.5 text-destructive" />
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              Diagnostik för Cast Away → sonos-bridge-push
            </p>
          </div>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-4 space-y-3">
          {!data && (
            <Button variant="outline" size="sm" onClick={load} disabled={loading} className="w-full">
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Radio className="h-4 w-4 mr-2" />}
              Hämta bridge-status
            </Button>
          )}
          {data && (
            <div className="space-y-3 text-sm">
              {/* Connection status */}
              <div className="flex items-center gap-2 rounded-md bg-background/50 p-3 border border-border/40">
                {isRecent(data.updated_at) ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-primary flex-shrink-0" />
                    <span className="text-xs">Bridge aktiv — senaste push {new Date(data.updated_at).toLocaleTimeString('sv-SE')}</span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4 text-destructive flex-shrink-0" />
                    <span className="text-xs">
                      Ingen push senaste 2 min — senast {data.updated_at ? new Date(data.updated_at).toLocaleTimeString('sv-SE') : 'aldrig'}
                    </span>
                  </>
                )}
              </div>

              {/* Current track */}
              <div className="rounded-md bg-background/50 p-3 border border-border/40 space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Nuvarande låt</p>
                <p className="font-medium text-foreground">{data.track_name || '(ingen)'}</p>
                <p className="text-xs text-muted-foreground">{data.artist_name || '—'} · {data.album_name || '—'}</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mt-2">
                  <span className="text-muted-foreground">Status</span>
                  <span className="text-foreground">{data.playback_state?.replace('PLAYBACK_STATE_', '')}</span>
                  <span className="text-muted-foreground">Position</span>
                  <span className="text-foreground tabular-nums">{formatMs(data.position_ms)} / {formatMs(data.duration_ms)}</span>
                  <span className="text-muted-foreground">Volym</span>
                  <span className="text-foreground tabular-nums">{data.volume ?? '—'}{data.mute ? ' 🔇' : ''}</span>
                  <span className="text-muted-foreground">Mediatyp</span>
                  <span className="text-foreground">{data.media_type || '—'}</span>
                  <span className="text-muted-foreground">Spår</span>
                  <span className="text-foreground tabular-nums">{data.track_number ?? '—'} / {data.nr_tracks ?? '—'}</span>
                  <span className="text-muted-foreground">Sekvens</span>
                  <span className="text-foreground tabular-nums">{data.track_seq}</span>
                  <span className="text-muted-foreground">EQ</span>
                  <span className="text-foreground tabular-nums">
                    B:{data.bass ?? '—'} T:{data.treble ?? '—'} {data.loudness ? 'Loud' : ''} {data.crossfade ? 'X-fade' : ''}
                  </span>
                </div>
              </div>

              {/* Art source */}
              <div className="rounded-md bg-background/50 p-3 border border-border/40 space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Bildkälla</p>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className={`h-3.5 w-3.5 ${isBridgeArt(data.album_art_url) ? 'text-primary' : 'text-muted-foreground'}`} />
                  <span className="text-xs">Album art: {isBridgeArt(data.album_art_url) ? 'Bridge-uppladdad ✓' : data.album_art_url ? 'Cloud-resolvad' : 'Saknas'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className={`h-3.5 w-3.5 ${data.bg_image_url ? 'text-primary' : 'text-muted-foreground'}`} />
                  <span className="text-xs">Bakgrund: {data.bg_image_url ? 'Genererad ✓' : 'Väntar...'}</span>
                </div>
              </div>

              {/* Next track — always visible */}
              <div className="rounded-md bg-background/50 p-3 border border-border/40 space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Nästa låt{data.media_type !== 'radio' ? ' (förladdning)' : ''}</p>
                {data.media_type === 'radio' ? (
                  <p className="text-xs text-muted-foreground italic">RADIO — Ej aktuell</p>
                ) : data.next_track_name ? (
                  <>
                    <p className="text-xs text-foreground">{data.next_track_name} — {data.next_artist_name || '—'}</p>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className={`h-3.5 w-3.5 ${data.next_bg_image_url ? 'text-primary' : 'text-muted-foreground'}`} />
                      <span className="text-xs">Bakgrund: {data.next_bg_image_url ? 'Klar ✓' : 'Ej genererad'}</span>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground italic">Ingen nästa låt rapporterad från bridge</p>
                )}
              </div>

              {/* Track URI */}
              {data.track_uri && (
                <div className="rounded-md bg-background/50 p-3 border border-border/40">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Track URI</p>
                  <p className="text-[10px] font-mono text-foreground break-all select-all leading-relaxed bg-muted/50 p-2 rounded">
                    {data.track_uri}
                  </p>
                </div>
              )}

              <Button variant="outline" size="sm" onClick={load} disabled={loading} className="w-full">
                {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                Uppdatera
              </Button>
            </div>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}



function SonosDebugLog() {
  const [entries, setEntries] = useState<TvDebugEntry[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setEntries([...getTvDebugEntries()]);
    return subscribeTvDebug(() => setEntries([...getTvDebugEntries()]));
  }, [isOpen]);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="border border-border rounded-lg p-3">
        <CollapsibleTrigger className="flex items-center justify-between w-full text-left">
          <span className="text-sm font-medium">Logg (låtbyten & bakgrund)</span>
          <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-3 max-h-[300px] overflow-y-auto rounded bg-black/50 p-2 font-mono text-[11px] leading-relaxed space-y-0.5">
            {entries.length === 0 && (
              <div className="text-muted-foreground text-center py-4">Inga loggar ännu — spela musik så dyker de upp</div>
            )}
            {entries.map((e, i) => {
              const time = new Date(e.ts).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
              const catColor = e.category === 'sonos' ? 'text-blue-400' : 'text-green-400';
              return (
                <div key={i} className="flex gap-2">
                  <span className="text-muted-foreground flex-shrink-0">{time}</span>
                  <span className={`flex-shrink-0 ${catColor}`}>{e.category === 'sonos' ? '♫' : '🖼'}</span>
                  <span className="text-foreground break-all">{e.message}</span>
                  {e.elapsed != null && <span className="text-yellow-400 flex-shrink-0">{e.elapsed}ms</span>}
                </div>
              );
            })}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function SonosSettings() {
  const { handleAlbumArtChange } = useAlbumArt();
  const [isLoading, setIsLoading] = useState(true);
  const [showOnDashboard, setShowOnDashboard] = useState(true);
  const [bgBlur, setBgBlur] = useState(40);
  const [bgBrightness, setBgBrightness] = useState(90);
  const [bgContrast, setBgContrast] = useState(1.0);
  const [bgSaturation, setBgSaturation] = useState(1.0);
  const [bgTopGradientOpacity, setBgTopGradientOpacity] = useState(0.45);
  const [bgTopGradientHeight, setBgTopGradientHeight] = useState(85);
  const [trackChangeOffset, setTrackChangeOffset] = useState(2.0);
  const [settingsId, setSettingsId] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setIsLoading(true);
    try {
      const { data: settings } = await supabase
        .from('sonos_settings')
        .select('id, bg_blur, bg_brightness, bg_contrast, bg_saturation, bg_top_gradient_opacity, bg_top_gradient_height, show_on_dashboard, track_change_offset_seconds')
        .limit(1)
        .maybeSingle();

      if (settings) {
        setSettingsId(settings.id);
        setShowOnDashboard(settings.show_on_dashboard ?? true);
        setBgBlur(settings.bg_blur ?? 40);
        setBgBrightness(settings.bg_brightness ?? 90);
        setBgContrast(settings.bg_contrast ?? 1.0);
        setBgSaturation(settings.bg_saturation ?? 1.0);
        setBgTopGradientOpacity(settings.bg_top_gradient_opacity ?? 0.45);
        setBgTopGradientHeight(settings.bg_top_gradient_height ?? 85);
        setTrackChangeOffset(Number(settings.track_change_offset_seconds) || 2.0);
      }
    } catch (error) {
      console.error('Failed to load Sonos settings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const saveField = useCallback(async (fields: Partial<Record<string, unknown>>) => {
    try {
      if (settingsId) {
        const { error } = await supabase
          .from('sonos_settings')
          .update(fields as never)
          .eq('id', settingsId);
        if (error) console.error('Failed to save setting:', error.message, fields);
      } else {
        const { data, error } = await supabase
          .from('sonos_settings')
          .insert(fields)
          .select('id')
          .single();
        if (error) console.error('Failed to insert setting:', error.message, fields);
        else if (data) setSettingsId(data.id);
      }
    } catch (error) {
      console.error('Failed to auto-save setting:', error);
    }
  }, [settingsId]);

  const handleShowOnDashboardChange = (value: boolean) => {
    setShowOnDashboard(value);
    saveField({ show_on_dashboard: value });
  };

  const [isRegenerating, setIsRegenerating] = useState(false);

  const saveAndRegenerate = async () => {
    setIsRegenerating(true);
    try {
      const bgFields = {
        bg_blur: bgBlur,
        bg_brightness: bgBrightness,
        bg_contrast: bgContrast,
        bg_saturation: bgSaturation,
        bg_top_gradient_opacity: bgTopGradientOpacity,
        bg_top_gradient_height: bgTopGradientHeight,
      };

      if (settingsId) {
        const { error } = await supabase
          .from('sonos_settings')
          .update(bgFields)
          .eq('id', settingsId);
        if (error) {
          toast.error('Kunde inte spara inställningar: ' + error.message);
          return;
        }
      } else {
        const { data, error } = await supabase
          .from('sonos_settings')
          .insert(bgFields)
          .select('id')
          .single();
        if (error) {
          toast.error('Kunde inte spara inställningar: ' + error.message);
          return;
        }
        if (data) setSettingsId(data.id);
      }

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-sonos-now-playing`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ bg_only: true }),
      });

      if (response.ok) {
        const { data: nowPlaying } = await supabase
          .from('sonos_now_playing')
          .select('bg_image_url, track_name')
          .limit(1)
          .maybeSingle();
        if (nowPlaying?.bg_image_url) {
          handleAlbumArtChange(nowPlaying.bg_image_url, nowPlaying.track_name ?? undefined);
        }
      }

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
      <BridgeEndpoints />

      {/* General Sonos Settings */}
      <div className="space-y-4 p-4 rounded-lg border border-border/60 bg-muted/20">
        <p className="settings-label">Allmänna inställningar</p>
        <p className="text-xs text-muted-foreground">
          Data skickas automatiskt från den lokala Sonos-bridge:n (Cast Away)
        </p>

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

        {/* Track Change Offset */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Synk-justering vid låtbyte</Label>
            <span className="text-sm text-muted-foreground tabular-nums">{trackChangeOffset.toFixed(1)}s</span>
          </div>
          <Slider
            value={[trackChangeOffset]}
            min={0}
            max={5}
            step={0.5}
            onValueChange={(v) => setTrackChangeOffset(v[0])}
            onValueCommit={(v) => saveField({ track_change_offset_seconds: v[0] })}
          />
          <p className="text-xs text-muted-foreground">
            Byt till nästa låts metadata X sekunder innan nuvarande låt tar slut för sömlösa övergångar
          </p>
        </div>
      </div>

      <Collapsible>
        <div className="p-4 rounded-lg border border-border/60 bg-muted/20">
          <CollapsibleTrigger className="flex items-center justify-between w-full group">
            <div className="space-y-0.5 text-left">
              <p className="settings-label">Bakgrundsbildbehandling (TV-läge)</p>
              <p className="text-xs text-muted-foreground">
                Styr hur albumomslaget bearbetas till bakgrundsbild
              </p>
            </div>
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pt-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Oskärpa</Label>
                <span className="text-sm text-muted-foreground tabular-nums">{bgBlur}px</span>
              </div>
              <Slider value={[bgBlur]} min={0} max={50} step={1} onValueChange={(v) => setBgBlur(v[0])} />
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Ljusstyrka (mål-luminans)</Label>
                <span className="text-sm text-muted-foreground tabular-nums">{Math.round(bgBrightness)}</span>
              </div>
              <Slider value={[bgBrightness]} min={10} max={100} step={5} onValueChange={(v) => setBgBrightness(v[0])} />
              <p className="text-xs text-muted-foreground">
                Normaliserad ljusstyrka — alla bilder når samma ljusnivå oavsett original. Rekommenderat ~70-100
              </p>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Överkantsmörkläggning</Label>
                <span className="text-sm text-muted-foreground tabular-nums">{Math.round(bgTopGradientOpacity * 100)}%</span>
              </div>
              <Slider value={[bgTopGradientOpacity]} min={0} max={1.0} step={0.05} onValueChange={(v) => setBgTopGradientOpacity(v[0])} />
              <p className="text-xs text-muted-foreground">
                Mörkare överkant för bättre läsbarhet av headern
              </p>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Överkantshöjd</Label>
                <span className="text-sm text-muted-foreground tabular-nums">{bgTopGradientHeight}px</span>
              </div>
              <Slider value={[bgTopGradientHeight]} min={0} max={200} step={5} onValueChange={(v) => setBgTopGradientHeight(v[0])} />
            </div>
            <Button onClick={saveAndRegenerate} disabled={isRegenerating} variant="outline" size="sm" className="w-full">
              {isRegenerating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Spara & generera om bakgrund
            </Button>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* Bridge Status Diagnostics */}
      <BridgeDiagnostics />



      {/* Sonos Debug Log */}
      <SonosDebugLog />
    </div>
  );
}
