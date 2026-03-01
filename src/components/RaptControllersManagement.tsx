import { useState, useEffect } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AirVent, Check, X, ChevronUp, ChevronDown, Snowflake, Thermometer, Flame, Clock, Settings2, Pill, Link2, Unlink, Palette } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { sv } from "date-fns/locale";
import { useControllersManagement } from "@/hooks";
import { getActualTemp } from "@/lib/temp-display";
import { supabase } from "@/integrations/supabase/client";

interface RaptControllersManagementProps {
  pillCompEnabled?: boolean;
}

export function RaptControllersManagement({ pillCompEnabled = false }: RaptControllersManagementProps) {
  const {
    controllers, pills, selectedControllers, selectedControllersData,
    coolerControllerId, loading, editingLimitsId,
    tempMinTemp, setTempMinTemp, tempMaxTemp, setTempMaxTemp, updating,
    handleToggleController, handleMoveUp, handleMoveDown,
    handleStartEditLimits, handleCancelEditLimits, handleUpdateLimits,
    handleLinkPill, handleToggleCooler, getLinkedPillIds, getSyncIntervalText,
    handleUpdatePillColor,
  } = useControllersManagement();

  // Fetch original targets for all followed controllers
  const [originalTargets, setOriginalTargets] = useState<Record<string, number>>({});
  
  useEffect(() => {
    if (!pillCompEnabled || controllers.length === 0) {
      setOriginalTargets({});
      return;
    }
    
    const fetchOriginalTargets = async () => {
      const targets: Record<string, number> = {};
      const nonCoolerIds = controllers
        .filter(c => !c.is_glycol_cooler)
        .map(c => c.controller_id);
      
      if (nonCoolerIds.length === 0) return;

      // Only use profile_target_temp for controllers with active sessions
      const { data: activeSessions } = await supabase
        .from('fermentation_sessions')
        .select('controller_id')
        .in('controller_id', nonCoolerIds)
        .in('status', ['running', 'paused']);

      const activeControllerIds = new Set((activeSessions ?? []).map(s => s.controller_id));

      if (activeControllerIds.size > 0) {
        const { data: ctrlRows } = await supabase
          .from('rapt_temp_controllers')
          .select('controller_id, profile_target_temp')
          .in('controller_id', Array.from(activeControllerIds))
          .not('profile_target_temp', 'is', null);

        if (ctrlRows) {
          for (const row of ctrlRows) {
            if (row.profile_target_temp != null) {
              targets[row.controller_id] = row.profile_target_temp;
            }
          }
        }
      }
      // No fallback to auto_cooling_adjustments - that's cooler data, not PID snitt-mål
      
      setOriginalTargets(targets);
    };
    
    fetchOriginalTargets();
  }, [pillCompEnabled, controllers]);

  if (loading) {
    return <div className="text-sm text-muted-foreground">Laddar Temperature Controllers...</div>;
  }

  if (controllers.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        Inga Temperature Controllers hittades. Kör RAPT synkronisering för att hämta dina controllers.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Clock className="h-3 w-3" />
        Synkroniseras {getSyncIntervalText()}
      </p>
      
      <div className="grid gap-4">
        {controllers.map((controller) => {
          const controllerIndex = selectedControllersData.findIndex(c => c.controller_id === controller.controller_id);
          const isFirst = controllerIndex === 0;
          const isLast = controllerIndex === selectedControllersData.length - 1;
          const isSelected = selectedControllers[controller.controller_id];
          const isCooler = coolerControllerId === controller.controller_id;
          const displayTemp = getActualTemp(controller.pill_temp, controller.current_temp, pillCompEnabled);
          const isActivelyCooling = controller.cooling_enabled && displayTemp !== null && controller.target_temp !== null && displayTemp > (controller.target_temp + (controller.cooling_hysteresis ?? 0.2));
          const isActivelyHeating = controller.heating_enabled && displayTemp !== null && controller.target_temp !== null && displayTemp < (controller.target_temp - (controller.heating_hysteresis ?? 0.2));
          
          return (
            <Card 
              key={controller.id} 
              className={`overflow-hidden transition-all ${
                isCooler 
                  ? 'border-blue-500/50 bg-gradient-to-br from-blue-500/5 to-transparent' 
                  : 'hover:border-primary/30'
              } ${!isSelected ? 'opacity-60' : ''}`}
            >
              {/* Header with name and badges */}
              <div className={`px-4 py-3 border-b border-border/50 ${isCooler ? 'bg-blue-500/10' : 'bg-muted/30'}`}>
                <div className="flex items-center gap-3 mb-2">
                  <div className={`p-2 rounded-lg ${isCooler ? 'bg-blue-500/20 text-blue-500' : 'bg-primary/10 text-primary'}`}>
                    {isCooler ? <Snowflake className="h-5 w-5" /> : <Thermometer className="h-5 w-5" />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-semibold break-words">{controller.name}</h4>
                      <Badge 
                        variant="secondary" 
                        className={`text-xs cursor-pointer transition-colors ${
                          isCooler 
                            ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/30 hover:bg-blue-500/30' 
                            : 'bg-muted/50 text-muted-foreground border-border/50 hover:bg-muted'
                        }`}
                        onClick={() => handleToggleCooler(controller.controller_id)}
                      >
                        <Snowflake className="h-3 w-3 mr-1" />
                        {isCooler ? 'Glykolkylare ✓' : 'Kylare?'}
                      </Badge>
                    </div>
                    {controller.last_update && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Uppdaterad {formatDistanceToNow(new Date(controller.last_update), { addSuffix: true, locale: sv })}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center space-x-2 bg-background/50 px-2 py-1 rounded-md border border-border/50">
                    <Checkbox
                      id={`controller-${controller.controller_id}`}
                      checked={selectedControllers[controller.controller_id] || false}
                      onCheckedChange={(checked) => handleToggleController(controller.controller_id, !!checked)}
                    />
                    <label htmlFor={`controller-${controller.controller_id}`} className="text-xs cursor-pointer leading-none whitespace-nowrap font-medium">
                      Synlig
                    </label>
                  </div>
                  
                  {isSelected && controllerIndex >= 0 && (
                    <div className="flex items-center gap-0.5">
                      <Button size="sm" variant="ghost" onClick={() => handleMoveUp(controller.controller_id)} disabled={isFirst} className="h-7 w-7 p-0" title="Flytta upp">
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleMoveDown(controller.controller_id)} disabled={isLast} className="h-7 w-7 p-0" title="Flytta ner">
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
              
              {/* Temperature data */}
              <div className="px-4 py-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-muted/30 rounded-lg p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">{pillCompEnabled ? 'Aktuell (snitt)' : 'Aktuell (ctrl)'}</p>
                    <p className="text-xl font-bold tabular-nums">
                      {displayTemp !== null ? `${displayTemp.toFixed(1)}°` : '—'}
                    </p>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">{pillCompEnabled ? 'Mål (snitt)' : 'Mål (ctrl)'}</p>
                    <p className="text-xl font-bold tabular-nums text-primary">
                      {pillCompEnabled && originalTargets[controller.controller_id] != null
                        ? `${originalTargets[controller.controller_id].toFixed(1)}°`
                        : controller.target_temp !== null ? `${controller.target_temp.toFixed(1)}°` : '—'}
                    </p>
                    {pillCompEnabled && originalTargets[controller.controller_id] != null && controller.target_temp !== null && (
                      <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                        Ctrl-mål (PID): {controller.target_temp.toFixed(1)}°
                      </p>
                    )}
                  </div>
                  <div className={`rounded-lg p-3 text-center transition-all ${isActivelyHeating ? 'bg-orange-500/20 border border-orange-500/30' : 'bg-muted/30'}`}>
                    <p className="text-xs text-muted-foreground mb-1">Värme</p>
                    <div className="flex items-center justify-center gap-1.5">
                      <Flame className={`h-4 w-4 ${isActivelyHeating ? 'text-orange-500' : 'text-muted-foreground'}`} />
                      <span className={`text-sm font-medium ${isActivelyHeating ? 'text-orange-600 dark:text-orange-400' : 'text-muted-foreground'}`}>
                        {controller.heating_enabled ? (isActivelyHeating ? 'PÅ' : 'Av') : 'Ej aktiv'}
                      </span>
                    </div>
                  </div>
                  <div className={`rounded-lg p-3 text-center transition-all ${isActivelyCooling ? 'bg-blue-500/20 border border-blue-500/30' : 'bg-muted/30'}`}>
                    <p className="text-xs text-muted-foreground mb-1">Kyla</p>
                    <div className="flex items-center justify-center gap-1.5">
                      <Snowflake className={`h-4 w-4 ${isActivelyCooling ? 'text-blue-500' : 'text-muted-foreground'}`} />
                      <span className={`text-sm font-medium ${isActivelyCooling ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'}`}>
                        {controller.cooling_enabled ? (isActivelyCooling ? 'PÅ' : 'Av') : 'Ej aktiv'}
                      </span>
                    </div>
                  </div>
                </div>
                
                {isCooler && (
                  <div className="mt-3 p-2 bg-blue-500/10 border border-blue-500/20 rounded-md">
                    <p className="text-xs text-blue-600 dark:text-blue-400 flex items-center gap-2">
                      <Snowflake className="h-3 w-3" />
                      Denna controller styr glykolkylaren och kan inte köra fermenteringsprofiler
                    </p>
                  </div>
                )}
                
                {/* Pill linking */}
                {!isCooler && (() => {
                  const linkedPill = controller.linked_pill_id ? pills.find(p => p.pill_id === controller.linked_pill_id) : null;
                  
                  return (
                    <div className="mt-3 pt-3 border-t border-border/50">
                      {linkedPill ? (
                        <div className="flex items-center gap-3 p-2.5 rounded-lg border transition-all" style={{ backgroundColor: `${linkedPill.color}08`, borderColor: `${linkedPill.color}25` }}>
                          <div className="p-2 rounded-lg shrink-0" style={{ backgroundColor: `${linkedPill.color}20` }}>
                            <Pill className="h-4 w-4" style={{ color: linkedPill.color }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate" style={{ color: linkedPill.color }}>{linkedPill.name}</p>
                            {linkedPill.last_update && (
                              <p className="text-[11px] text-muted-foreground mt-0.5">
                                Senast sedd {formatDistanceToNow(new Date(linkedPill.last_update), { addSuffix: false, locale: sv })} sedan
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <Select value={controller.linked_pill_id || "none"} onValueChange={(value) => handleLinkPill(controller.controller_id, value === "none" ? null : value)} disabled={updating}>
                              <SelectTrigger className="w-auto h-7 px-2 gap-1 text-xs border-border/30 bg-background/50">
                                <span className="text-muted-foreground">Byt</span>
                              </SelectTrigger>
                              <SelectContent className="bg-card border-border z-50">
                                <SelectItem value="none">
                                  <div className="flex items-center gap-2"><Unlink className="h-3 w-3 text-muted-foreground" /><span>Koppla bort</span></div>
                                </SelectItem>
                                {pills.map((pill) => {
                                  const isAlreadyLinked = getLinkedPillIds(controller.controller_id).includes(pill.pill_id);
                                  return (
                                    <SelectItem key={pill.pill_id} value={pill.pill_id} disabled={isAlreadyLinked}>
                                      <div className="flex items-center gap-2">
                                        <Pill className="h-3 w-3" style={{ color: pill.color }} />
                                        <span>{pill.name}</span>
                                        {isAlreadyLinked && <span className="text-xs text-muted-foreground">(upptagen)</span>}
                                      </div>
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                            <Select value={linkedPill.color} onValueChange={(value) => handleUpdatePillColor(linkedPill.pill_id, value)} disabled={updating}>
                              <SelectTrigger className="w-auto h-7 px-2 gap-1 text-xs border-border/30 bg-background/50">
                                <div className="flex items-center gap-1.5">
                                  <div className="w-3 h-3 rounded-full border border-border/50" style={{ backgroundColor: linkedPill.color }} />
                                </div>
                              </SelectTrigger>
                              <SelectContent className="bg-card border-border z-50">
                                {[
                                  { value: '#F5A623', label: 'Gul' },
                                  { value: '#4CAF50', label: 'Grön' },
                                  { value: '#42A5F5', label: 'Blå' },
                                  { value: '#EF5350', label: 'Röd' },
                                  { value: '#AB47BC', label: 'Lila' },
                                  { value: '#FF7043', label: 'Orange' },
                                  { value: '#26C6DA', label: 'Cyan' },
                                  { value: '#EC407A', label: 'Rosa' },
                                ].map((opt) => (
                                  <SelectItem key={opt.value} value={opt.value}>
                                    <div className="flex items-center gap-2">
                                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: opt.value }} />
                                      <span>{opt.label}</span>
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Pill className="h-4 w-4" /><span>Pill:</span>
                          </div>
                          <Select value="none" onValueChange={(value) => handleLinkPill(controller.controller_id, value === "none" ? null : value)} disabled={updating}>
                            <SelectTrigger className="w-[180px] h-8">
                              <SelectValue placeholder="Välj pill..." />
                            </SelectTrigger>
                            <SelectContent className="bg-card border-border z-50">
                              <SelectItem value="none">
                                <div className="flex items-center gap-2"><Unlink className="h-3 w-3 text-muted-foreground" /><span>Ingen koppling</span></div>
                              </SelectItem>
                              {pills.map((pill) => {
                                const isAlreadyLinked = getLinkedPillIds(controller.controller_id).includes(pill.pill_id);
                                return (
                                  <SelectItem key={pill.pill_id} value={pill.pill_id} disabled={isAlreadyLinked}>
                                    <div className="flex items-center gap-2">
                                      <Pill className="h-3 w-3" style={{ color: pill.color }} />
                                      <span>{pill.name}</span>
                                      {isAlreadyLinked && <span className="text-xs text-muted-foreground">(upptagen)</span>}
                                    </div>
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  );
                })()}
                
                {/* Temperature limits */}
                <div className="mt-3 pt-3 border-t border-border/50">
                  {editingLimitsId === controller.controller_id ? (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                      <div className="flex items-center gap-2 flex-1">
                        <Settings2 className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">Min:</span>
                        <Input type="number" value={tempMinTemp} onChange={(e) => setTempMinTemp(e.target.value)} placeholder="°" className="w-20 h-8" disabled={updating} />
                        <span className="text-sm text-muted-foreground">Max:</span>
                        <Input type="number" value={tempMaxTemp} onChange={(e) => setTempMaxTemp(e.target.value)} placeholder="°" className="w-20 h-8" disabled={updating} />
                      </div>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => handleUpdateLimits(controller.controller_id)} disabled={updating} className="h-8 w-8 p-0 text-green-600 hover:text-green-700 hover:bg-green-500/10">
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={handleCancelEditLimits} disabled={updating} className="h-8 w-8 p-0">
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => handleStartEditLimits(controller)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors group w-full">
                      <Settings2 className="h-4 w-4 group-hover:text-primary transition-colors" />
                      <span>Temperaturintervall:</span>
                      <span className="font-medium text-foreground">
                        {controller.min_target_temp ?? -5}° — {controller.max_target_temp ?? 25}°
                      </span>
                    </button>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
