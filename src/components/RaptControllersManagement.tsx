import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronUp, ChevronDown, Snowflake, Thermometer, Flame, Clock, Settings2, Pill } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { sv } from "date-fns/locale";
import { useControllersManagement } from "@/hooks";



export function RaptControllersManagement() {
  const {
    controllers, pills, selectedControllers, selectedControllersData,
    coolerControllerId, loading,
    handleToggleController, handleMoveUp, handleMoveDown, getSyncIntervalText,
  } = useControllersManagement();

  // SSOT: profile_target_temp is always available on the controller row — no extra fetch needed
  const originalTargets: Record<string, number> = {};
  for (const c of controllers) {
    if (!c.is_glycol_cooler && c.profile_target_temp != null) {
      originalTargets[c.controller_id] = c.profile_target_temp;
    }
  }

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
          const displayTemp = controller.actual_temp;
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
                        className={`text-xs ${
                          isCooler
                            ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/30'
                            : 'bg-muted/50 text-muted-foreground border-border/50'
                        }`}
                      >
                        <Snowflake className="h-3 w-3 mr-1" />
                        {isCooler ? 'Glykolkylare' : 'Jästank'}
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
                    <p className="text-xs text-muted-foreground mb-1">Aktuell</p>
                    <p className="text-xl font-bold tabular-nums">
                      {displayTemp !== null ? `${displayTemp.toFixed(1)}°` : '—'}
                    </p>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Mål</p>
                    <p className="text-xl font-bold tabular-nums text-primary">
                      {originalTargets[controller.controller_id] != null
                        ? `${originalTargets[controller.controller_id].toFixed(1)}°`
                        : controller.target_temp !== null ? `${controller.target_temp.toFixed(1)}°` : '—'}
                    </p>
                    {originalTargets[controller.controller_id] != null && controller.target_temp !== null && (
                      <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                        PT100-mål (PID): {controller.target_temp.toFixed(1)}°
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
                        <div className="flex items-center gap-3 p-2.5 rounded-lg border" style={{ backgroundColor: `${linkedPill.color}08`, borderColor: `${linkedPill.color}25` }}>
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
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Pill className="h-4 w-4" /><span>Ingen pill kopplad (sätts på Pi:n)</span>
                        </div>
                      )}
                    </div>
                  );
                })()}
                
                {/* Temperature limits */}
                {/* Temperature limits (styrs på Pi:n) */}
                <div className="mt-3 pt-3 border-t border-border/50">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Settings2 className="h-4 w-4" />
                    <span>Temperaturintervall:</span>
                    <span className="font-medium text-foreground">
                      {controller.min_target_temp ?? -5}° — {controller.max_target_temp ?? 25}°
                    </span>
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
