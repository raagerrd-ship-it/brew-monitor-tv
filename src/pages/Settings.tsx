import { toast } from "@/hooks";
import { BrewManagement } from "@/components/BrewManagement";
import { RaptPillsManagement } from "@/components/RaptPillsManagement";
import { RaptControllersManagement } from "@/components/RaptControllersManagement";
import { SyncChecklist } from "@/components/SyncChecklist";
import { AutomationFeatureStatus } from "@/components/AutomationFeatureStatus";
import { AutoCoolingDecisionLogs } from "@/components/AutoCoolingDecisionLogs";
import { AiAuditHistory } from "@/components/AiAuditHistory";
import { AiTunableParameters } from "@/components/AiTunableParameters";
import { LearnedCompensationBaselines } from "@/components/LearnedCompensationBaselines";
import { LearnedCoolerMarginValues } from "@/components/LearnedCoolerMarginValues";
import { LearnedMarginHistory } from "@/components/LearnedMarginHistory";
import { LearnedStallBoostValues } from "@/components/LearnedStallBoostValues";
import { LearnedPidCoolingRates } from "@/components/LearnedPidCoolingRates";
import { CombinedControllerChart } from "@/components/controller-chart";


import { LearnedThermalProfile } from "@/components/LearnedThermalProfile";
import { LearnedDutyCycle } from "@/components/LearnedDutyCycle";
import { SgCalibrationStatus } from "@/components/SgCalibrationStatus";
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
import { RefreshCw, LogOut, ChevronDown, Thermometer, Cpu, Beer, AlertCircle, AlertTriangle, Pencil, Timer, Check, Tv, Snowflake, FlaskConical, Pill, Cloud, Music, ArrowDown, ArrowUp, History, Clock, Brain, Shield, Printer, Bot, Gauge } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { sv } from "date-fns/locale";
import { useIsMobile, useExternalUserSettings, useSettingsData } from "@/hooks";
import { useMemo, useCallback } from "react";
import { Badge } from "@/components/ui/badge";

import { useExternalAuth } from "@/contexts/ExternalAuthContext";
import { SettingsSection, SettingsDivider, CategorySeparator } from "@/components/ui/settings-section";

export default function Settings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobile = useIsMobile();
  const settings = useSettingsData();




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

  // Build combined chart controller list with colors from linked pills
  const combinedChartControllers = useMemo(() => {
    const pillColorMap = new Map<string, string>();
    for (const pill of (settings.headerPillsData ?? [])) {
      pillColorMap.set(pill.pill_id, pill.color || '#3b82f6');
    }
    const defaultColors = ['#eab308', '#3b82f6', '#22c55e', '#ef4444', '#a855f7'];
    let colorIdx = 0;
    return settings.availableControllers.map(c => {
      let color = c.linked_pill_id ? pillColorMap.get(c.linked_pill_id) : undefined;
      if (!color) {
        color = defaultColors[colorIdx % defaultColors.length];
        colorIdx++;
      }
      return {
        id: c.id,
        name: c.name,
        color,
        isGlycolCooler: c.is_glycol_cooler,
      };
    });
  }, [settings.availableControllers, settings.headerPillsData]);

  if (settings.loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className={`bg-gradient-to-br from-background via-background to-primary/5 ${isMobile ? 'min-h-screen' : 'h-full flex flex-col'}`}>
      <DashboardHeader />
      <div className={isMobile ? '' : 'flex-1 overflow-y-auto'} style={isMobile ? { paddingTop: `${settings.visibleControllersCount > 0 ? 136 : 72}px` } : undefined}>
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
                    <CollapsibleTrigger className="flex items-center justify-between w-full cursor-pointer group">
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <div className="absolute inset-0 bg-primary/20 blur-lg rounded-full" />
                          <div className="relative flex items-center justify-center w-8 h-8 rounded-xl bg-primary/10 border border-primary/30">
                            <Beer className="h-4 w-4 text-primary" />
                          </div>
                        </div>
                        <span className="text-sm font-semibold">Brewfather</span>
                        {settings.brewfatherEnabled ? (
                          settings.apiSettings?.brewfather?.configured ? (
                            <Badge variant="outline" className="text-[10px] border-success/40 text-success px-1.5 py-0">
                              <Check className="h-2.5 w-2.5 mr-0.5" /> OK
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] border-warning/40 text-warning px-1.5 py-0">
                              <AlertCircle className="h-2.5 w-2.5 mr-0.5" /> Saknas
                            </Badge>
                          )
                        ) : (
                          <Badge variant="outline" className="text-[10px] border-muted-foreground/40 text-muted-foreground px-1.5 py-0">
                            Avstängd
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center justify-center w-7 h-7 rounded-lg transition-all group-hover:bg-primary/15">
                        <ChevronDown className="h-4.5 w-4.5 text-muted-foreground transition-all duration-200 group-hover:text-primary group-hover:scale-110 [[data-state=open]_&]:rotate-180" />
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-4 space-y-3">
                      <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30 border border-border/40">
                        <div className="flex items-center gap-2">
                          <Beer className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-xs">Aktivera Brewfather</span>
                        </div>
                        <Switch checked={settings.brewfatherEnabled} onCheckedChange={(checked) => settings.handleAutoSettingChange('brewfather_enabled', !!checked)} />
                      </div>
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
                      {settings.brewfatherEnabled && <>
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
                      </>}
                    </CollapsibleContent>
                  </div>
                </Collapsible>

                {/* RAPT */}
                <Collapsible>
                  <div className="rounded-lg border bg-card/30 border-border/40 p-3">
                    <CollapsibleTrigger className="flex items-center justify-between w-full cursor-pointer group">
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
                      <div className="flex items-center justify-center w-7 h-7 rounded-lg transition-all group-hover:bg-primary/15">
                        <ChevronDown className="h-4.5 w-4.5 text-muted-foreground transition-all duration-200 group-hover:text-primary group-hover:scale-110 [[data-state=open]_&]:rotate-180" />
                      </div>
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
                    <CollapsibleTrigger className="flex items-center justify-between w-full cursor-pointer group">
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
                      <div className="flex items-center justify-center w-7 h-7 rounded-lg transition-all group-hover:bg-primary/15">
                        <ChevronDown className="h-4.5 w-4.5 text-muted-foreground transition-all duration-200 group-hover:text-primary group-hover:scale-110 [[data-state=open]_&]:rotate-180" />
                      </div>
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
                    <CollapsibleTrigger className="flex items-center justify-between w-full cursor-pointer group">
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
                      <div className="flex items-center justify-center w-7 h-7 rounded-lg transition-all group-hover:bg-primary/15">
                        <ChevronDown className="h-4.5 w-4.5 text-muted-foreground transition-all duration-200 group-hover:text-primary group-hover:scale-110 [[data-state=open]_&]:rotate-180" />
                      </div>
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
                <div className="rounded-lg border border-border/40 bg-card/30 p-3 space-y-2.5">
                  <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 gap-y-2">
                    <div className="space-y-0.5">
                      <p className="text-xs font-medium text-foreground">Snabb-synk</p>
                      <p className="text-[10px] text-muted-foreground">RAPT + Brewfather mätvärden + automation</p>
                    </div>
                    <Select value={settings.quickSyncInterval} onValueChange={settings.handleQuickSyncIntervalChange}>
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
                    <Button onClick={settings.handleQuickSync} disabled={settings.quickSyncing} variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary">
                      <RefreshCw className={`h-3 w-3 ${settings.quickSyncing ? 'animate-spin' : ''}`} />
                    </Button>

                    <div className="space-y-0.5">
                      <p className="text-xs font-medium text-foreground">Full synk</p>
                      <p className="text-[10px] text-muted-foreground">Alla batchar + enheter + AI-optimering</p>
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
                    <Gauge className="h-4 w-4 text-accent" />
                    <div>
                      <p className="text-sm font-medium">PID-reglering</p>
                      <p className="text-[11px] text-muted-foreground">Kärnfunktion — alltid aktiv</p>
                    </div>
                  </div>
                  <Switch checked={true} disabled className="opacity-60" />
                </div>
                <SettingsDivider />
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
                <SettingsDivider />
                <div className="flex items-center justify-between py-2.5 px-1">
                  <div className="flex items-center gap-2.5">
                    <FlaskConical className="h-4 w-4 text-accent" />
                    <div>
                      <p className="text-sm font-medium">SG-temperaturkorrektion</p>
                      <p className="text-[11px] text-muted-foreground">Korrigerar gravityvärden vid synk baserat på temperatur</p>
                    </div>
                  </div>
                  <Switch checked={settings.sgTempCorrectionEnabled} onCheckedChange={settings.handleSgTempCorrectionEnabledChange} />
                </div>
              </div>
            </SettingsSection>

            {/* Live-status */}
            {settings.autoCoolingEnabled && settings.coolerControllerId && (
              <SettingsSection icon={Thermometer} title="Live-status" variant="muted" collapsible defaultOpen={false}>
                <div className="space-y-3">
                  <AutomationFeatureStatus
                    autoCoolingEnabled={settings.autoCoolingEnabled}
                    stallDetectionEnabled={settings.stallDetectionEnabled}
                    overshootPreventionEnabled={settings.overshootPreventionEnabled}
                    aiAuditEnabled={settings.aiAuditEnabled}
                    availableControllers={settings.availableControllers}
                    coolerControllerId={settings.coolerControllerId}
                    followedControllerIds={settings.followedControllerIds}
                    lastAdjustment={settings.lastAdjustment}
                    lastAutoCoolingCheck={settings.lastQuickSync}
                    autoCoolingInterval={settings.quickSyncInterval}
                   />
                  <SettingsDivider />
                  <AiTunableParameters />
                </div>
              </SettingsSection>
            )}

            <CategorySeparator icon={Brain} label="Inlärning" />
                <SettingsSection icon={Thermometer} title="Controller-inlärning" description="PID-kompensation, stall-boost och termiska hastigheter per controller" collapsible defaultOpen={false}>
                  <LearnedCompensationBaselines />
                  <SettingsDivider />
                  <LearnedStallBoostValues />
                  <SettingsDivider />
                  <LearnedDutyCycle />
                </SettingsSection>

                <SettingsSection icon={Snowflake} title="Kylare-inlärning" description="Inlärda marginaler för den gemensamma kylaren" collapsible defaultOpen={false}>
                  <LearnedThermalProfile />
                  <SettingsDivider />
                  <LearnedPidCoolingRates />
                  <SettingsDivider />
                  <LearnedCoolerMarginValues />
                  <SettingsDivider />
                  <LearnedMarginHistory />
                </SettingsSection>

                <SettingsSection icon={Pill} title="SG-kalibrering" description="Automatisk temperaturkorrektion per pill (ankare + inlärd residual)" collapsible defaultOpen={false}>
                  <SgCalibrationStatus />
                </SettingsSection>

            <CategorySeparator icon={FlaskConical} label="Profiler" />
            <SettingsSection icon={FlaskConical} title="Fermenteringsprofiler" description="Skapa och hantera temperaturschemat för fermenteringen">
              <FermentationProfilesManagement />
            </SettingsSection>

            <CategorySeparator icon={History} label="Historik" />
            <SettingsSection icon={Snowflake} title="Kylningshistorik" description="Kombinerad temperatur- och kylnings-% graf" collapsible defaultOpen={false}>
              <CombinedControllerChart controllers={combinedChartControllers} />
            </SettingsSection>
            <SettingsSection icon={History} title="Synkroniseringshistorik" description="Loggar RAPT-synk, PID-reglering, kylautomatik och hårdvaruändringar varje cykel" collapsible defaultOpen={false}>
              <AutoCoolingDecisionLogs />
            </SettingsSection>
            <SettingsSection icon={Bot} title="AI-justeringshistorik" description="Historik över AI-auditens parameterändringar" collapsible defaultOpen={false}>
              <AiAuditHistory />
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
