import { toast } from "@/hooks";
import { BrewManagement } from "@/components/BrewManagement";
import { RaptPillsManagement } from "@/components/RaptPillsManagement";
import { RaptControllersManagement } from "@/components/RaptControllersManagement";
import { SyncChecklist } from "@/components/SyncChecklist";
import { AutoCoolingCountdown } from "@/components/AutoCoolingCountdown";
import { AutoCoolingDecisionLogs } from "@/components/AutoCoolingDecisionLogs";
import { LearnedCompensationBaselines } from "@/components/LearnedCompensationBaselines";
import { LearnedCoolerMarginValues } from "@/components/LearnedCoolerMarginValues";
import { LearnedStallBoostValues } from "@/components/LearnedStallBoostValues";
import { LearnedGlycolRates } from "@/components/LearnedGlycolRates";
import { LearnedThermalRates } from "@/components/LearnedThermalRates";
import { FermentationProfilesManagement } from "@/components/fermentation";
import { ExternalLoginDialog } from "@/components/ExternalLoginDialog";
import { SonosSettings } from "@/components/sonos/SonosSettings";
import { PrinterSettings } from "@/components/PrinterSettings";
import { DashboardHeader, HEADER_HEIGHT } from "@/components/DashboardHeader";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { useSearchParams } from "react-router-dom";
import { RefreshCw, LogOut, ChevronDown, Thermometer, Cpu, Beer, AlertCircle, AlertTriangle, Pencil, Timer, Check, Tv, Snowflake, FlaskConical, Pill, Cloud, Music, ArrowDown, ArrowUp, History, Clock, Brain, Shield, Printer } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { sv } from "date-fns/locale";
import { useIsMobile, useExternalUserSettings, useSettingsData } from "@/hooks";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useExternalAuth } from "@/contexts/ExternalAuthContext";
import { SettingsSection, SettingsDivider, CategorySeparator } from "@/components/ui/settings-section";

export default function Settings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobile = useIsMobile();
  const settings = useSettingsData();
  const { toast } = settings as any; // toast is used via handlers

  // Get initial tab from URL or default to "sync"
  const validTabs = ["sync", "automation", "devices", "brews"];
  const tabFromUrl = searchParams.get("tab");
  const initialTab = tabFromUrl && validTabs.includes(tabFromUrl) ? tabFromUrl : "sync";

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value });
  };

  // External auth for brew timer
  const { isAuthenticated: isExternalAuthenticated, user: externalUser, signOut: externalSignOut, isLoading: externalLoading } = useExternalAuth();
  const { timerTvModeOnly, setTimerTvModeOnly, isLoading: settingsLoading } = useExternalUserSettings();

  // Tab status indicators
  const syncTabStatus = useMemo(() => {
    if (!settings.apiSettings) return null;
    const brewfatherMissing = !settings.apiSettings.brewfather.configured;
    const raptMissing = !settings.apiSettings.rapt.configured;
    if (brewfatherMissing || raptMissing) {
      return { type: 'warning' as const, count: (brewfatherMissing ? 1 : 0) + (raptMissing ? 1 : 0) };
    }
    return null;
  }, [settings.apiSettings]);

  const devicesTabStatus = useMemo(() => {
    const total = settings.visiblePillsCount + settings.visibleControllersCount;
    if (total === 0) return null;
    return { type: 'info' as const, count: total };
  }, [settings.visiblePillsCount, settings.visibleControllersCount]);

  const brewsTabStatus = useMemo(() => {
    if (settings.visibleBrewsCount === 0) return null;
    return { type: 'info' as const, count: settings.visibleBrewsCount };
  }, [settings.visibleBrewsCount]);

  if (settings.loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className={`bg-gradient-to-br from-background via-background to-primary/5 ${isMobile ? 'min-h-screen' : 'h-full flex flex-col'}`}>
      <DashboardHeader
        controllers={settings.headerControllers}
        pills={settings.headerPillsData}
      />
      <div className={isMobile ? '' : 'flex-1 overflow-y-auto'} style={isMobile ? { paddingTop: `${settings.headerControllers.length > 0 ? 136 : 72}px` } : undefined}>
        <div className="w-full px-4 sm:px-6 lg:px-8 pb-8 pt-4">
        
        <Tabs value={initialTab} onValueChange={handleTabChange} className="w-full">
          <TabsList className="grid w-full grid-cols-4 mb-6">
            <TabsTrigger value="sync" className="flex items-center gap-2 relative">
              <RefreshCw className="h-4 w-4" />
              Synk
              {syncTabStatus && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] text-destructive-foreground">
                  <AlertCircle className="h-3 w-3" />
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="automation" className="flex items-center gap-2 relative">
              <Thermometer className="h-4 w-4" />
              Automatik
            </TabsTrigger>
            <TabsTrigger value="devices" className="flex items-center gap-2 relative">
              <Cpu className="h-4 w-4" />
              Enheter
              {devicesTabStatus && (
                <Badge className="absolute -top-2 -right-2 h-5 min-w-5 px-1 text-[10px] flex items-center justify-center bg-success text-success-foreground hover:bg-success">
                  {devicesTabStatus.count}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="brews" className="flex items-center gap-2 relative">
              <Beer className="h-4 w-4" />
              Öl
              {brewsTabStatus && (
                <Badge className="absolute -top-2 -right-2 h-5 min-w-5 px-1 text-[10px] flex items-center justify-center bg-success text-success-foreground hover:bg-success">
                  {brewsTabStatus.count}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* SYNC TAB */}
          <TabsContent value="sync" className="space-y-6">

            {/* ═══════════════ DATAKÄLLOR ═══════════════ */}
            <SettingsSection icon={Cpu} title="Datakällor" description="Anslutna API:er och integrationer">
              <div className="space-y-3">
                {/* Brewfather */}
                <Collapsible>
                  <div className="rounded-lg border bg-card/30 border-border/40 p-3">
                    <CollapsibleTrigger className="flex items-center justify-between w-full cursor-pointer">
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <div className="absolute inset-0 bg-primary/20 blur-lg rounded-full" />
                          <div className="relative flex items-center justify-center w-8 h-8 rounded-xl bg-primary/10 border border-primary/30">
                            <Beer className="h-4 w-4 text-primary" />
                          </div>
                        </div>
                        <span className="text-sm font-semibold">Brewfather</span>
                        {settings.apiSettings?.brewfather?.configured ? (
                          <Badge variant="outline" className="text-[10px] border-success/40 text-success px-1.5 py-0">
                            <Check className="h-2.5 w-2.5 mr-0.5" /> OK
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] border-warning/40 text-warning px-1.5 py-0">
                            <AlertCircle className="h-2.5 w-2.5 mr-0.5" /> Saknas
                          </Badge>
                        )}
                      </div>
                      <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-4 space-y-3">
                      {settings.apiSettings?.brewfather && (
                        <div className="text-xs space-y-1 p-3 rounded-lg bg-muted/30 border border-border/40">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">User ID:</span>
                            <span className="font-mono">{settings.apiSettings.brewfather.userId}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">API-nyckel:</span>
                            <span className="font-mono">{settings.apiSettings.brewfather.apiKey}</span>
                          </div>
                        </div>
                      )}
                      <SettingsDivider />
                      <div className="space-y-3">
                        <span className="text-xs font-medium text-muted-foreground">Automatisk hantering</span>
                        <div className="grid gap-2 grid-cols-2">
                          <div className="flex items-center space-x-2 p-2 rounded-lg bg-muted/40 border border-border/40">
                            <Checkbox id="auto-activate-fermenting" checked={settings.autoActivateFermenting}
                              onCheckedChange={(checked) => settings.handleAutoSettingChange('auto_activate_fermenting', !!checked)} />
                            <label htmlFor="auto-activate-fermenting" className="text-[11px] cursor-pointer">Visa nya jäsande</label>
                          </div>
                          <div className="flex items-center space-x-2 p-2 rounded-lg bg-muted/40 border border-border/40">
                            <Checkbox id="auto-hide-completed" checked={settings.autoHideCompleted}
                              onCheckedChange={(checked) => settings.handleAutoSettingChange('auto_hide_completed', !!checked)} />
                            <label htmlFor="auto-hide-completed" className="text-[11px] cursor-pointer">Dölj klara</label>
                          </div>
                          <div className="flex items-center space-x-2 p-2 rounded-lg bg-muted/40 border border-border/40">
                            <Checkbox id="auto-hide-conditioning" checked={settings.autoHideConditioning}
                              onCheckedChange={(checked) => settings.handleAutoSettingChange('auto_hide_conditioning', !!checked)} />
                            <label htmlFor="auto-hide-conditioning" className="text-[11px] cursor-pointer">Dölj konditionerade</label>
                          </div>
                          <div className="flex items-center space-x-2 p-2 rounded-lg bg-muted/40 border border-border/40">
                            <Checkbox id="auto-hide-archived" checked={settings.autoHideArchived}
                              onCheckedChange={(checked) => settings.handleAutoSettingChange('auto_hide_archived', !!checked)} />
                            <label htmlFor="auto-hide-archived" className="text-[11px] cursor-pointer">Dölj arkiverade</label>
                          </div>
                        </div>
                      </div>
                      <button className="text-[11px] text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
                        onClick={() => toast({ title: "Ändra API-uppgifter", description: "Uppdatera dina Brewfather API-nycklar i backend-inställningarna." })}>
                        <Pencil className="h-3 w-3" /> Ändra API-uppgifter
                      </button>
                    </CollapsibleContent>
                  </div>
                </Collapsible>

                {/* RAPT */}
                <Collapsible>
                  <div className="rounded-lg border bg-card/30 border-border/40 p-3">
                    <CollapsibleTrigger className="flex items-center justify-between w-full cursor-pointer">
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <div className="absolute inset-0 bg-primary/20 blur-lg rounded-full" />
                          <div className="relative flex items-center justify-center w-8 h-8 rounded-xl bg-primary/10 border border-primary/30">
                            <Cloud className="h-4 w-4 text-primary" />
                          </div>
                        </div>
                        <span className="text-sm font-semibold">RAPT</span>
                        {settings.apiSettings?.rapt?.configured ? (
                          <Badge variant="outline" className="text-[10px] border-success/40 text-success px-1.5 py-0">
                            <Check className="h-2.5 w-2.5 mr-0.5" /> OK
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] border-warning/40 text-warning px-1.5 py-0">
                            <AlertCircle className="h-2.5 w-2.5 mr-0.5" /> Saknas
                          </Badge>
                        )}
                      </div>
                      <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-4 space-y-3">
                      {settings.apiSettings?.rapt && (
                        <div className="text-xs space-y-1 p-3 rounded-lg bg-muted/30 border border-border/40">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Användarnamn:</span>
                            <span className="font-mono">{settings.apiSettings.rapt.username}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">API-nyckel:</span>
                            <span className="font-mono">{settings.apiSettings.rapt.apiSecret}</span>
                          </div>
                        </div>
                      )}
                      <button className="text-[11px] text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
                        onClick={() => toast({ title: "Ändra API-uppgifter", description: "Uppdatera dina RAPT API-nycklar i backend-inställningarna." })}>
                        <Pencil className="h-3 w-3" /> Ändra API-uppgifter
                      </button>
                    </CollapsibleContent>
                  </div>
                </Collapsible>

                {/* Brygg-timer */}
                <Collapsible>
                  <div className="rounded-lg border bg-card/30 border-border/40 p-3">
                    <CollapsibleTrigger className="flex items-center justify-between w-full cursor-pointer">
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <div className="absolute inset-0 bg-primary/20 blur-lg rounded-full" />
                          <div className="relative flex items-center justify-center w-8 h-8 rounded-xl bg-primary/10 border border-primary/30">
                            <Timer className="h-4 w-4 text-primary" />
                          </div>
                        </div>
                        <span className="text-sm font-semibold">Brygg-timer</span>
                        {isExternalAuthenticated ? (
                          <Badge variant="outline" className="text-[10px] border-success/40 text-success px-1.5 py-0">
                            <Check className="h-2.5 w-2.5 mr-0.5" /> Ansluten
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] border-muted-foreground/40 text-muted-foreground px-1.5 py-0">
                            Ej ansluten
                          </Badge>
                        )}
                      </div>
                      <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-4 space-y-3">
                      {externalLoading ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <RefreshCw className="h-3 w-3 animate-spin" /> Laddar...
                        </div>
                      ) : isExternalAuthenticated ? (
                        <>
                          <div className="text-xs p-3 rounded-lg bg-muted/30 border border-border/40">
                            <span className="text-muted-foreground">Ansluten som:</span>{' '}
                            <span className="font-mono">{externalUser?.email}</span>
                          </div>
                          <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30 border border-border/40">
                            <div className="flex items-center gap-2">
                              <Tv className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="text-xs">Bara i TV-läge</span>
                            </div>
                            <Switch checked={timerTvModeOnly} disabled={settingsLoading} onCheckedChange={setTimerTvModeOnly} />
                          </div>
                          <button className="text-[11px] text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1"
                            onClick={() => { if (confirm('Vill du koppla från timer-kontot?')) externalSignOut(); }}>
                            <LogOut className="h-3 w-3" /> Koppla från
                          </button>
                        </>
                      ) : (
                        <Button variant="outline" size="sm" className="text-xs" onClick={() => settings.setExternalLoginDialogOpen(true)}>
                          Anslut timer-konto
                        </Button>
                      )}
                    </CollapsibleContent>
                  </div>
                </Collapsible>

                {/* Sonos */}
                <Collapsible>
                  <div className="rounded-lg border bg-card/30 border-border/40 p-3">
                    <CollapsibleTrigger className="flex items-center justify-between w-full cursor-pointer">
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <div className="absolute inset-0 bg-primary/20 blur-lg rounded-full" />
                          <div className="relative flex items-center justify-center w-8 h-8 rounded-xl bg-primary/10 border border-primary/30">
                            <Music className="h-4 w-4 text-primary" />
                          </div>
                        </div>
                        <span className="text-sm font-semibold">Sonos</span>
                        <Badge variant="outline" className="text-[10px] border-success/40 text-success px-1.5 py-0">
                          <Check className="h-2.5 w-2.5 mr-0.5" /> OK
                        </Badge>
                      </div>
                      <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-4">
                      <p className="text-xs text-muted-foreground">Ansluten. Se inställningar under <span className="font-medium text-foreground">Sonos</span>-sektionen nedan.</p>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              </div>
            </SettingsSection>

            {/* ═══════════════ SYNK-FREKVENSER ═══════════════ */}
            <CategorySeparator icon={RefreshCw} label="Synkronisering" />

            <SettingsSection icon={RefreshCw} title="Frekvenser" description="Automatisk och manuell synk för alla datakällor">
              <div className="space-y-3">
                {/* Brewfather */}
                <div className="rounded-lg border border-border/40 bg-card/30 p-3 space-y-2.5">
                  <div className="flex items-center gap-2 mb-1">
                    <Beer className="h-4 w-4 text-primary" />
                    <span className="text-xs font-semibold tracking-wide uppercase text-foreground/80">Brewfather</span>
                  </div>
                  <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 gap-y-2">
                    <div className="space-y-0.5">
                      <p className="text-xs font-medium text-foreground">Snabb-synk</p>
                      <p className="text-[10px] text-muted-foreground">Hämtar senaste mätvärden</p>
                    </div>
                    <Select value={settings.syncInterval} onValueChange={settings.handleSyncIntervalChange}>
                      <SelectTrigger className="h-7 w-[100px] text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-card border-border z-50">
                        <SelectItem value="0">Aldrig</SelectItem>
                        <SelectItem value="60">1 min</SelectItem>
                        <SelectItem value="300">5 min</SelectItem>
                        <SelectItem value="600">10 min</SelectItem>
                        <SelectItem value="900">15 min</SelectItem>
                        <SelectItem value="3600">1 tim</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button onClick={settings.handleQuickSync} disabled={settings.quickSyncing} variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary">
                      <RefreshCw className={`h-3 w-3 ${settings.quickSyncing ? 'animate-spin' : ''}`} />
                    </Button>

                    <div className="space-y-0.5">
                      <p className="text-xs font-medium text-foreground">Full synk</p>
                      <p className="text-[10px] text-muted-foreground">Synkar alla batchar och recept</p>
                    </div>
                    <Select value={settings.fullSyncInterval} onValueChange={settings.handleFullSyncIntervalChange}>
                      <SelectTrigger className="h-7 w-[100px] text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-card border-border z-50">
                        <SelectItem value="0">Aldrig</SelectItem>
                        <SelectItem value="3600">1 tim</SelectItem>
                        <SelectItem value="21600">6 tim</SelectItem>
                        <SelectItem value="43200">12 tim</SelectItem>
                        <SelectItem value="86400">24 tim</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button onClick={settings.handleFullSync} disabled={settings.syncing} variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary">
                      <RefreshCw className={`h-3 w-3 ${settings.syncing ? 'animate-spin' : ''}`} />
                    </Button>
                  </div>
                  {settings.syncing && settings.syncSteps.length > 0 && <SyncChecklist steps={settings.syncSteps} />}
                </div>

                {/* RAPT */}
                <div className="rounded-lg border border-border/40 bg-card/30 p-3 space-y-2.5">
                  <div className="flex items-center gap-2 mb-1">
                    <Cloud className="h-4 w-4 text-primary" />
                    <span className="text-xs font-semibold tracking-wide uppercase text-foreground/80">RAPT</span>
                  </div>
                  <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 gap-y-2">
                    <div className="space-y-0.5">
                      <p className="text-xs font-medium text-foreground">Snabb-synk</p>
                      <p className="text-[10px] text-muted-foreground">Pill & temperaturstyrning</p>
                    </div>
                    <Select value={settings.raptSyncInterval} onValueChange={settings.handleRaptSyncIntervalChange}>
                      <SelectTrigger className="h-7 w-[100px] text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-card border-border z-50">
                        <SelectItem value="0">Aldrig</SelectItem>
                        <SelectItem value="60">1 min</SelectItem>
                        <SelectItem value="300">5 min</SelectItem>
                        <SelectItem value="600">10 min</SelectItem>
                        <SelectItem value="900">15 min</SelectItem>
                        <SelectItem value="1800">30 min</SelectItem>
                        <SelectItem value="3600">1 tim</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button onClick={settings.handleRaptQuickSync} disabled={settings.raptQuickSyncing} variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary">
                      <RefreshCw className={`h-3 w-3 ${settings.raptQuickSyncing ? 'animate-spin' : ''}`} />
                    </Button>

                    <div className="space-y-0.5">
                      <p className="text-xs font-medium text-foreground">Full synk</p>
                      <p className="text-[10px] text-muted-foreground">Alla enheter och konfiguration</p>
                    </div>
                    <Select value={settings.raptFullSyncInterval} onValueChange={settings.handleRaptFullSyncIntervalChange}>
                      <SelectTrigger className="h-7 w-[100px] text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-card border-border z-50">
                        <SelectItem value="0">Aldrig</SelectItem>
                        <SelectItem value="21600">6 tim</SelectItem>
                        <SelectItem value="43200">12 tim</SelectItem>
                        <SelectItem value="86400">24 tim</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button onClick={settings.handleRaptFullSync} disabled={settings.raptSyncing} variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary">
                      <RefreshCw className={`h-3 w-3 ${settings.raptSyncing ? 'animate-spin' : ''}`} />
                    </Button>
                  </div>
                  {settings.raptSyncing && settings.raptSyncSteps.length > 0 && <SyncChecklist steps={settings.raptSyncSteps} />}
                </div>
              </div>
            </SettingsSection>

            {/* ═══════════════ SONOS ═══════════════ */}
            <CategorySeparator icon={Music} label="Sonos" />
            <SettingsSection icon={Music} title="Sonos-inställningar" description="Rum, widget och bakgrundsbildbehandling">
              <SonosSettings />
            </SettingsSection>

            {/* ═══════════════ DISPLAY ═══════════════ */}
            <CategorySeparator icon={Tv} label="Display" />
            <SettingsSection icon={Tv} title="TV-styrning" description="Styr anslutna TV-enheter och splash-skärm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Uppdatera TV:ar</p>
                  <p className="text-xs text-muted-foreground">Tvinga omläsning av alla TV-enheter</p>
                </div>
                <Button variant="outline" size="sm" className="text-xs" onClick={settings.handleForceTvRefresh}>
                  <Tv className="h-3.5 w-3.5 mr-1.5" /> Uppdatera
                </Button>
              </div>
              <SettingsDivider />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Splash-fördröjning</p>
                  <p className="text-xs text-muted-foreground">Tid innan splash-loggan försvinner</p>
                </div>
                <Select value={settings.splashDelayMs} onValueChange={settings.handleSplashDelayChange}>
                  <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">0s</SelectItem>
                    <SelectItem value="500">0.5s</SelectItem>
                    <SelectItem value="1000">1s</SelectItem>
                    <SelectItem value="1500">1.5s</SelectItem>
                    <SelectItem value="2000">2s</SelectItem>
                    <SelectItem value="3000">3s</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </SettingsSection>

            {/* Logga ut */}
            <div className="pt-4 pb-2 flex justify-center">
              <button onClick={settings.handleLogout}
                className="text-xs text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1.5">
                <LogOut className="h-3.5 w-3.5" /> Logga ut
              </button>
            </div>
          </TabsContent>

          {/* AUTOMATION TAB */}
          <TabsContent value="automation" className="space-y-6">
            <SettingsSection icon={Cpu} title="Autonoma funktioner" description="Aktivera eller inaktivera automatisk styrning">
              <div className="space-y-1">
                <div className="flex items-center justify-between py-2.5 px-1">
                  <div className="flex items-center gap-2.5">
                    <Snowflake className="h-4 w-4 text-accent" />
                    <div>
                      <p className="text-sm font-medium">Autojustera glykolkylare</p>
                      {settings.autoCoolingEnabled && !settings.coolerControllerId && (
                        <p className="text-[11px] text-warning">Ingen kylare markerad under Enheter</p>
                      )}
                    </div>
                  </div>
                  <Switch checked={settings.autoCoolingEnabled} onCheckedChange={settings.handleAutoCoolingEnabledChange} />
                </div>
                <SettingsDivider />
                <div className="flex items-center justify-between py-2.5 px-1">
                  <div className="flex items-center gap-2.5">
                    <AlertTriangle className="h-4 w-4 text-accent" />
                    <p className="text-sm font-medium">Stall-detektering</p>
                  </div>
                  <Switch checked={settings.stallDetectionEnabled} onCheckedChange={settings.handleStallDetectionEnabledChange} />
                </div>
                <SettingsDivider />
                <div className="flex items-center justify-between py-2.5 px-1">
                  <div className="flex items-center gap-2.5">
                    <Pill className="h-4 w-4 text-accent" />
                    <p className="text-sm font-medium">Pill-kompensation</p>
                  </div>
                  <Switch checked={settings.pillCompEnabled} onCheckedChange={settings.handlePillCompEnabledChange} />
                </div>
                <SettingsDivider />
                <div className="flex items-center justify-between py-2.5 px-1">
                  <div className="flex items-center gap-2.5">
                    <Shield className="h-4 w-4 text-accent" />
                    <p className="text-sm font-medium">Overshoot-prevention</p>
                  </div>
                  <Switch checked={settings.overshootPreventionEnabled} onCheckedChange={settings.handleOvershootPreventionChange} />
                </div>
                <SettingsDivider />
                <div className="flex items-center justify-between py-2.5 px-1">
                  <div className="flex items-center gap-2.5">
                    <Brain className="h-4 w-4 text-accent" />
                    <p className="text-sm font-medium">AI-optimering</p>
                  </div>
                  <Switch checked={settings.aiAuditEnabled} onCheckedChange={settings.handleAiAuditEnabledChange} />
                </div>
              </div>
            </SettingsSection>

            {/* Live-status */}
            {settings.autoCoolingEnabled && settings.coolerControllerId && (
              <SettingsSection icon={Thermometer} title="Live-status" variant="muted">
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    {/* Cooler */}
                    <div className="rounded-lg bg-muted/30 border border-border/40 p-3 space-y-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Kylare</span>
                      {(() => {
                        const cooler = settings.availableControllers.find(c => c.id === settings.coolerControllerId);
                        if (!cooler) return <p className="text-xs text-muted-foreground">Ej hittad</p>;
                        const current = cooler.current_temp != null ? Number(cooler.current_temp).toFixed(1) : null;
                        const target = cooler.target_temp != null ? Number(cooler.target_temp).toFixed(1) : null;
                        const isActivelyCooling = cooler.cooling_enabled && cooler.current_temp != null && cooler.target_temp != null && cooler.current_temp > cooler.target_temp;
                        return (
                          <>
                            <p className="text-sm font-medium truncate">{cooler.name}</p>
                            <div className="text-xs text-muted-foreground">
                              {current && <span>{current}°</span>}
                              {current && target && <span className="mx-1">→</span>}
                              {target && <span className="text-foreground">{target}°</span>}
                            </div>
                            <div className={`text-[10px] flex items-center gap-1 ${isActivelyCooling ? 'text-accent' : 'text-muted-foreground/60'}`}>
                              <Snowflake className="h-3 w-3" />
                              {isActivelyCooling ? 'Kyler ↓' : cooler.cooling_enabled ? 'Vid mål' : 'Av'}
                            </div>
                          </>
                        );
                      })()}
                    </div>

                    {/* Followed */}
                    <div className="rounded-lg bg-muted/30 border border-border/40 p-3 space-y-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Följda ({settings.followedControllerIds.length})
                      </span>
                      {(() => {
                        const followed = settings.availableControllers.filter(c => settings.followedControllerIds.includes(c.id));
                        if (followed.length === 0) return <p className="text-xs text-muted-foreground">Inga</p>;
                        return followed.map(fc => {
                          const temp = fc.current_temp ?? fc.pill_temp;
                          return (
                            <div key={fc.id} className="flex items-center justify-between text-xs">
                              <span className="truncate font-medium">{fc.name}</span>
                              <span className="text-muted-foreground shrink-0 ml-2">
                                {temp != null ? `${Number(temp).toFixed(1)}°` : '—'}
                                {fc.target_temp != null && <span className="text-foreground ml-0.5">→{fc.target_temp.toFixed(1)}°</span>}
                              </span>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                    <div className="flex items-center gap-1.5">
                      <Clock className="h-3 w-3" />
                      <span>Nästa kontroll</span>
                    </div>
                    <AutoCoolingCountdown 
                      lastAdjustmentTime={settings.lastAutoCoolingCheck}
                      checkIntervalMinutes={parseInt(settings.autoCoolingInterval)}
                      enabled={settings.autoCoolingEnabled}
                      coolingActive={(() => {
                        const cooler = settings.availableControllers.find(c => c.id === settings.coolerControllerId);
                        return cooler?.cooling_enabled ?? false;
                      })()}
                      currentTemp={(() => {
                        const followedControllers = settings.availableControllers.filter(c => 
                          settings.followedControllerIds.includes(c.controller_id) && c.cooling_enabled === true
                        );
                        if (followedControllers.length === 0) return null;
                        const withTarget = followedControllers.filter(c => c.target_temp != null);
                        if (withTarget.length === 0) return null;
                        const lowest = withTarget.reduce((min, c) => c.target_temp! < min.target_temp! ? c : min);
                        return lowest.current_temp ?? lowest.pill_temp ?? null;
                      })()}
                      targetTemp={(() => {
                        const followedControllers = settings.availableControllers.filter(c => 
                          settings.followedControllerIds.includes(c.controller_id) && c.cooling_enabled === true
                        );
                        if (followedControllers.length === 0) return null;
                        const withTarget = followedControllers.filter(c => c.target_temp != null);
                        if (withTarget.length === 0) return null;
                        return Math.min(...withTarget.map(c => c.target_temp!));
                      })()}
                      coolingHysteresis={(() => {
                        const followedControllers = settings.availableControllers.filter(c => 
                          settings.followedControllerIds.includes(c.controller_id) && c.cooling_enabled === true
                        );
                        if (followedControllers.length === 0) return null;
                        const withTarget = followedControllers.filter(c => c.target_temp != null);
                        if (withTarget.length === 0) return null;
                        const lowest = withTarget.reduce((min, c) => c.target_temp! < min.target_temp! ? c : min);
                        return lowest.cooling_hysteresis ?? null;
                      })()}
                    />
                  </div>

                  {settings.lastAdjustment && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
                      <History className="h-3 w-3 shrink-0" />
                      <span>
                        Senast: {parseFloat(Number(settings.lastAdjustment.old_target_temp).toFixed(1))}° → {parseFloat(Number(settings.lastAdjustment.new_target_temp).toFixed(1))}°
                        {settings.lastAdjustment.new_target_temp < settings.lastAdjustment.old_target_temp 
                          ? <ArrowDown className="h-3 w-3 text-accent inline ml-0.5" />
                          : <ArrowUp className="h-3 w-3 text-primary inline ml-0.5" />
                        }
                        <span className="ml-1 text-muted-foreground/60">
                          {formatDistanceToNow(new Date(settings.lastAdjustment.created_at), { addSuffix: true, locale: sv })}
                        </span>
                      </span>
                    </div>
                  )}
                </div>
              </SettingsSection>
            )}

            <Collapsible defaultOpen={false}>
              <CollapsibleTrigger className="w-full cursor-pointer">
                <CategorySeparator icon={Brain} label="Inlärning" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SettingsSection icon={Brain} title="Inlärda värden" description="Systemets inlärda parametrar per controller">
                  <LearnedStallBoostValues />
                  <SettingsDivider />
                  <LearnedCompensationBaselines />
                  <SettingsDivider />
                  <LearnedCoolerMarginValues />
                  <SettingsDivider />
                  <LearnedGlycolRates />
                  <SettingsDivider />
                  <LearnedThermalRates />
                </SettingsSection>
              </CollapsibleContent>
            </Collapsible>

            <CategorySeparator icon={FlaskConical} label="Profiler" />
            <SettingsSection icon={FlaskConical} title="Fermenteringsprofiler" description="Skapa och hantera temperaturschemat för fermenteringen">
              <FermentationProfilesManagement />
            </SettingsSection>

            <CategorySeparator icon={History} label="Historik" />
            <SettingsSection icon={History} title="Justeringshistorik" description="Historik över alla automatiska justeringar">
              <AutoCoolingDecisionLogs />
            </SettingsSection>
          </TabsContent>

          {/* DEVICES TAB */}
          <TabsContent value="devices" className="space-y-6">
            <SettingsSection icon={Thermometer} title="Temperature Controllers" description="Välj vilka Temperature Controllers som ska visas på dashboarden">
              <RaptControllersManagement />
            </SettingsSection>
            <SettingsSection icon={Pill} title="RAPT Pills" description="Ej kopplade pills som kan visas separat på dashboarden">
              <RaptPillsManagement />
            </SettingsSection>
            <CategorySeparator icon={Printer} label="Skrivare" />
            <SettingsSection icon={Printer} title="Termoskrivare" description="Bluetooth-anslutning till etikettskrivare">
              <PrinterSettings />
            </SettingsSection>
          </TabsContent>

          {/* BREWS TAB */}
          <TabsContent value="brews">
            <BrewManagement />
          </TabsContent>
        </Tabs>
        </div>
      </div>
      
      <ExternalLoginDialog 
        open={settings.externalLoginDialogOpen} 
        onOpenChange={settings.setExternalLoginDialogOpen} 
      />
    </div>
  );
}
