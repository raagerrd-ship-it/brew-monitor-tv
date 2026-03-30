import { useState, useEffect, useCallback } from "react";
import { useAlbumArt } from "@/contexts/AlbumArtContext";
import { getTvDebugEntries, subscribeTvDebug, type TvDebugEntry } from "@/lib/tv-debug-log";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Loader2, Music, ExternalLink, Unlink, RefreshCw, ChevronDown, ImageIcon, CheckCircle2, XCircle, Circle, Radio, Wifi, WifiOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface SonosGroup {
  id: string;
  name: string;
  householdId: string;
}

function BridgeDiagnostics() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data: row } = await supabase
        .from('sonos_now_playing')
        .select('track_name, artist_name, album_name, playback_state, volume, mute, bass, treble, loudness, crossfade, media_type, track_number, nr_tracks, track_uri, duration_ms, position_ms, track_seq, updated_at, album_art_url, album_art_url_small, bg_image_url, widget_art_url, next_track_name, next_artist_name, next_bg_image_url, next_widget_art_url')
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
                <div className="flex items-center gap-2">
                  <CheckCircle2 className={`h-3.5 w-3.5 ${data.widget_art_url ? 'text-primary' : 'text-muted-foreground'}`} />
                  <span className="text-xs">Widget: {data.widget_art_url ? 'Genererad ✓' : 'Väntar...'}</span>
                </div>
              </div>

              {/* Next track */}
              {data.next_track_name && (
                <div className="rounded-md bg-background/50 p-3 border border-border/40 space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Nästa låt (förprocessad)</p>
                  <p className="text-xs text-foreground">{data.next_track_name} — {data.next_artist_name || '—'}</p>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className={`h-3.5 w-3.5 ${data.next_bg_image_url ? 'text-primary' : 'text-muted-foreground'}`} />
                    <span className="text-xs">Bakgrund: {data.next_bg_image_url ? 'Klar ✓' : 'Ej genererad'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className={`h-3.5 w-3.5 ${data.next_widget_art_url ? 'text-primary' : 'text-muted-foreground'}`} />
                    <span className="text-xs">Widget: {data.next_widget_art_url ? 'Klar ✓' : 'Ej genererad'}</span>
                  </div>
                </div>
              )}

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

function ArtResolutionDiagnostics() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const loadDiagnostics = async () => {
    setLoading(true);
    try {
      const { data: row } = await supabase
        .from('sonos_now_playing')
        .select('track_name, artist_name, album_art_url, album_art_url_small, bg_image_url, widget_art_url, next_track_name, next_artist_name, next_album_art_url, next_bg_image_url, next_widget_art_url, playback_state, updated_at')
        .limit(1)
        .single();
      setData(row);
    } catch (e) {
      console.error('Failed to load art diagnostics:', e);
    } finally {
      setLoading(false);
    }
  };

  const getArtSourceType = (url: string | null): string => {
    if (!url) return 'Saknas';
    if (url.includes('i.scdn.co') || url.includes('spotify')) return 'Spotify';
    if (url.includes('lh3.googleusercontent.com')) return 'Google/YT Music';
    if (url.includes('img.youtube.com')) return 'YouTube Thumbnail';
    if (url.includes('supabase')) return 'Storage (bearbetad)';
    if (url.includes('192.168.') || url.includes('getaa')) return '⚠️ Lokal (ej åtkomlig)';
    return 'Publik CDN';
  };

  const StatusIcon = ({ ok }: { ok: boolean | null }) => {
    if (ok === null) return <Circle className="h-3.5 w-3.5 text-muted-foreground" />;
    return ok
      ? <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
      : <XCircle className="h-3.5 w-3.5 text-destructive" />;
  };

  return (
    <Collapsible>
      <div className="p-4 rounded-lg border border-border/60 bg-muted/20">
        <CollapsibleTrigger className="flex items-center justify-between w-full group">
          <div className="space-y-0.5 text-left">
            <p className="settings-label">Albumart-diagnostik</p>
            <p className="text-xs text-muted-foreground">
              Visa status för bildupplösning (4-stegs fallback)
            </p>
          </div>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-4 space-y-3">
          {!data && (
            <Button variant="outline" size="sm" onClick={loadDiagnostics} disabled={loading} className="w-full">
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ImageIcon className="h-4 w-4 mr-2" />}
              Hämta aktuell status
            </Button>
          )}
          {data && (
            <div className="space-y-4 text-sm">
              {/* Current track */}
              <div className="space-y-2">
                <p className="font-medium text-foreground">{data.track_name || '(ingen låt)'}</p>
                <p className="text-xs text-muted-foreground">{data.artist_name || ''} · {data.playback_state}</p>
              </div>

              {/* Raw Sonos URLs */}
              <div className="space-y-2 rounded-md bg-background/50 p-3 border border-border/40">
                <p className="text-xs font-medium text-muted-foreground">Rå Sonos-URL (nuvarande låt)</p>
                <p className="text-[10px] font-mono text-foreground break-all select-all leading-relaxed bg-muted/50 p-2 rounded">
                  {data.album_art_url_small || '(ingen URL från Sonos)'}
                </p>
                {data.next_album_art_url && (
                  <>
                    <p className="text-xs font-medium text-muted-foreground mt-2">Rå Sonos-URL (nästa låt)</p>
                    <p className="text-[10px] font-mono text-foreground break-all select-all leading-relaxed bg-muted/50 p-2 rounded">
                      {data.next_album_art_url}
                    </p>
                  </>
                )}
              </div>

              {/* Resolution chain for current track */}
              {(() => {
                const art = data.album_art_url;
                const raw = data.album_art_url_small;
                const isSpotifyCdn = art?.includes('i.scdn.co');
                const isGoogleCdn = art?.includes('googleusercontent');
                const isYouTube = art?.includes('img.youtube.com');
                const hasGetaa = raw?.includes('getaa');
                const hasSpotifyInRaw = raw?.includes('sonos-spotify') || raw?.includes('spotify');
                // Determine which step succeeded
                const step1aOk = isGoogleCdn && hasGetaa;
                const step1bOk = isSpotifyCdn && hasGetaa && hasSpotifyInRaw;
                const step2Ok = isSpotifyCdn && !hasGetaa;
                const step3Ok = isYouTube;
                const step4Ok = !!art && !step1aOk && !step1bOk && !step2Ok && !step3Ok;
                const resolvedStep = step1aOk ? '1a' : step1bOk ? '1b' : step2Ok ? '2' : step3Ok ? '3' : step4Ok ? '4' : null;
                return (
                  <div className="space-y-1.5 rounded-md bg-background/50 p-3 border border-border/40">
                    <p className="text-xs font-medium text-muted-foreground mb-2">Upplösningskedja — nuvarande låt</p>
                    {[
                      { id: '1a', label: 'getaa → publik URL', detail: step1aOk ? '✓ Google CDN' : hasGetaa ? '✗ Ej publik URL' : '✗ Ingen getaa' },
                      { id: '1b', label: 'getaa → Spotify oEmbed', detail: step1bOk ? '✓ Spotify oEmbed' : hasSpotifyInRaw ? '✗ oEmbed misslyckades' : '✗ Ej Spotify i u-param' },
                      { id: '2', label: 'objectId → Spotify oEmbed', detail: step2Ok ? '✓ Spotify CDN' : '✗ Ej Spotify' },
                      { id: '3', label: 'YouTube Thumbnail', detail: step3Ok ? '✓ YouTube' : '✗ Ej hittad' },
                      { id: '4', label: 'Spotify Search', detail: step4Ok ? '✓ Sökträff' : !art ? '✗ Ingen träff' : '—' },
                    ].map(s => (
                      <div key={s.id} className="flex items-center gap-2">
                        <StatusIcon ok={resolvedStep === s.id ? true : (resolvedStep && resolvedStep < s.id ? null : false)} />
                        <span className="text-xs">{s.id}. {s.label}</span>
                        <span className="ml-auto text-xs text-muted-foreground">{resolvedStep === s.id ? s.detail : resolvedStep && resolvedStep < s.id ? '—' : s.detail}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Art URLs */}
              <div className="space-y-1.5 rounded-md bg-background/50 p-3 border border-border/40">
                <p className="text-xs font-medium text-muted-foreground mb-2">Bildstatus</p>
                <div className="flex items-center gap-2">
                  <StatusIcon ok={!!data.album_art_url} />
                  <span className="text-xs">Album art</span>
                  <span className="ml-auto text-xs text-muted-foreground truncate max-w-[180px]">{getArtSourceType(data.album_art_url)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <StatusIcon ok={!!data.bg_image_url} />
                  <span className="text-xs">Bakgrundsbild</span>
                  <span className="ml-auto text-xs text-muted-foreground truncate max-w-[180px]">{getArtSourceType(data.bg_image_url)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <StatusIcon ok={!!data.widget_art_url} />
                  <span className="text-xs">Widget-bild</span>
                  <span className="ml-auto text-xs text-muted-foreground truncate max-w-[180px]">{getArtSourceType(data.widget_art_url)}</span>
                </div>
              </div>

              {/* Next track */}
              {data.next_track_name && (
                <div className="space-y-1.5 rounded-md bg-background/50 p-3 border border-border/40">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Nästa: {data.next_track_name}</p>
                  <div className="flex items-center gap-2">
                    <StatusIcon ok={!!data.next_album_art_url && !data.next_album_art_url.includes('192.168.')} />
                    <span className="text-xs">Album art</span>
                    <span className="ml-auto text-xs text-muted-foreground truncate max-w-[180px]">{getArtSourceType(data.next_album_art_url)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusIcon ok={!!data.next_bg_image_url} />
                    <span className="text-xs">Bakgrund</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusIcon ok={!!data.next_widget_art_url} />
                    <span className="text-xs">Widget</span>
                  </div>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Uppdaterad: {data.updated_at ? new Date(data.updated_at).toLocaleTimeString('sv-SE') : '—'}
              </p>

              <Button variant="outline" size="sm" onClick={loadDiagnostics} disabled={loading} className="w-full">
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

export function SonosSettings() {
  const { handleAlbumArtChange } = useAlbumArt();
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
  const [trackChangeOffset, setTrackChangeOffset] = useState(2.0);
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
        supabase
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
        setTrackChangeOffset(Number(settings.track_change_offset_seconds) || 2.0);
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
  const saveField = useCallback(async (fields: Partial<Record<string, unknown>>) => {
    try {
      if (settingsId) {
        const { error } = await supabase
          .from('sonos_settings')
          .update(fields)
          .eq('id', settingsId);
        if (error) {
          console.error('Failed to save setting:', error.message, fields);
        }
      } else {
        const { data, error } = await supabase
          .from('sonos_settings')
          .insert(fields)
          .select('id')
          .single();
        if (error) {
          console.error('Failed to insert setting:', error.message, fields);
        } else if (data) {
          setSettingsId(data.id);
        }
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

      console.log('saveAndRegenerate: saving bgFields', bgFields, 'settingsId:', settingsId);
      if (settingsId) {
        const { error } = await supabase
          .from('sonos_settings')
          .update(bgFields)
          .eq('id', settingsId);
        if (error) {
          console.error('saveAndRegenerate: update failed:', error.message);
          toast.error('Kunde inte spara inställningar: ' + error.message);
          return;
        }
        console.log('saveAndRegenerate: update succeeded');
      } else {
        const { data, error } = await supabase
          .from('sonos_settings')
          .insert(bgFields)
          .select('id')
          .single();
        if (error) {
          console.error('saveAndRegenerate: insert failed:', error.message);
          toast.error('Kunde inte spara inställningar: ' + error.message);
          return;
        }
        if (data) setSettingsId(data.id);
      }

      // Trigger server sync to regenerate background without touching playback state
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-sonos-now-playing`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ bg_only: true }),
      });

      // After regeneration, poll for the new bg_image_url and push it to the background
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
      {/* Connection Status (only show when NOT connected) */}
      {!isConnected && (
        <div className="flex items-center gap-3 p-4 rounded-lg border bg-card">
          <div className="p-2 rounded-full bg-muted">
            <Music className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="font-medium">Sonos</p>
            <p className="text-sm text-muted-foreground">
              Inte kopplat — tryck på penn-ikonen för att ansluta
            </p>
          </div>
        </div>
      )}

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

            {/* Background Blur */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Oskärpa</Label>
                <span className="text-sm text-muted-foreground tabular-nums">{bgBlur}px</span>
              </div>
              <Slider
                value={[bgBlur]}
                min={0}
                max={50}
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
                max={100}
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
              </CollapsibleContent>
            </div>
          </Collapsible>

          {/* Bridge Status Diagnostics */}
          <BridgeDiagnostics />

          {/* Art Resolution Diagnostics */}
          <ArtResolutionDiagnostics />

          {/* Sonos Debug Log */}
          <SonosDebugLog />
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
