import { useState, useEffect } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, CheckCircle2, XCircle, Info, Wrench, Snowflake, Pill, Workflow, Gauge } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const r1 = (v: number | null | undefined): string => {
  if (v === null || v === undefined) return '—';
  return parseFloat(Number(v).toFixed(1)).toString();
};
interface DecisionEntry {
  step: string;
  result: 'pass' | 'fail' | 'info' | 'action';
  message: string;
  details?: Record<string, unknown>;
}

interface DecisionLog {
  id: string;
  created_at: string;
  duration_ms: number;
  decision_count: number;
  decisions: DecisionEntry[];
  final_result: string;
  adjustment_made: boolean;
}

interface AdjustmentLog {
  id: string;
  created_at: string;
  reason: string;
  old_target_temp: number;
  new_target_temp: number;
  original_target_temp: number | null;
  cooler_controller_name: string;
  followed_controller_name: string | null;
  followed_current_temp: number | null;
  followed_target_temp: number | null;
  followed_hysteresis: number | null;
}

type AdjustmentCategory = 'pill-comp' | 'profil' | 'glykol';

type HistoryEntry = 
  | { type: 'decision'; data: DecisionLog; timestamp: string }
  | { type: 'adjustment'; data: AdjustmentLog; category: AdjustmentCategory; timestamp: string };

function categorizeAdjustment(reason: string): AdjustmentCategory {
  if (reason.startsWith('🎯')) return 'pill-comp';
  if (reason.startsWith('🔥')) return 'pill-comp'; // Stall boost
  if (reason.startsWith('🔧')) return 'profil';
  if (reason.startsWith('📈')) return 'profil';
  // Legacy overshoot/stall entries still categorize to pill-comp
  if (reason.startsWith('🌡️')) return 'pill-comp';
  if (reason.startsWith('🧠')) return 'pill-comp';
  if (reason.startsWith('🔄')) return 'glykol';
  if (reason.includes('Cooling recovery') || reason.includes('colder than needed') || reason.includes('struggling to cool') || reason.includes('Ingen följd controller')) return 'glykol';
  return 'glykol';
}

function getCategoryBadge(category: AdjustmentCategory) {
  switch (category) {
    case 'pill-comp':
      return (
        <Badge variant="default" className="text-[10px] px-1.5" style={{ 
          background: 'hsl(280 60% 60% / 0.2)', 
          color: 'hsl(280 60% 60%)', 
          borderColor: 'hsl(280 60% 60% / 0.3)' 
        }}>
          <Pill className="h-2.5 w-2.5 mr-0.5" />
          PID
        </Badge>
      );
    case 'profil':
      return (
        <Badge variant="default" className="text-[10px] px-1.5" style={{ 
          background: 'hsl(160 60% 45% / 0.2)', 
          color: 'hsl(160 60% 45%)', 
          borderColor: 'hsl(160 60% 45% / 0.3)' 
        }}>
          <Workflow className="h-2.5 w-2.5 mr-0.5" />
          Profil
        </Badge>
      );
    case 'glykol':
      return (
        <Badge variant="default" className="text-[10px] px-1.5" style={{ 
          background: 'hsl(210 80% 60% / 0.2)', 
          color: 'hsl(210 80% 60%)', 
          borderColor: 'hsl(210 80% 60% / 0.3)' 
        }}>
          <Snowflake className="h-2.5 w-2.5 mr-0.5" />
          Glykol
        </Badge>
      );
    default:
      return (
        <Badge variant="default" className="text-[10px] px-1.5" style={{ 
          background: 'hsl(210 80% 60% / 0.2)', 
          color: 'hsl(210 80% 60%)', 
          borderColor: 'hsl(210 80% 60% / 0.3)' 
        }}>
          <Gauge className="h-2.5 w-2.5 mr-0.5" />
          System
        </Badge>
      );
  }
}

function extractAiReasoning(reason: string): string | null {
  // AI reasoning is in format "🌡️ Overshoot: <reasoning> (XX% säker)" or "🧠 AI: <reasoning>"
  const cleaned = reason.replace(/^🌡️\s*/, '').replace(/^🧠\s*/, '');
  return cleaned || null;
}

export function AutoCoolingDecisionLogs() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [hideSystem, setHideSystem] = useState(true);

  useEffect(() => {
    loadAll();

    const ch1 = supabase
      .channel('decision-logs')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'auto_cooling_decision_logs' }, () => loadAll())
      .subscribe();

    const ch2 = supabase
      .channel('adjustment-logs')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'auto_cooling_adjustments' }, () => loadAll())
      .subscribe();

    return () => {
      supabase.removeChannel(ch1);
      supabase.removeChannel(ch2);
    };
  }, []);

  const loadAll = async () => {
    try {
      const [decisionRes, adjustmentRes] = await Promise.all([
        supabase
          .from('auto_cooling_decision_logs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(30),
        supabase
          .from('auto_cooling_adjustments')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(30),
      ]);

      const decisionEntries: HistoryEntry[] = (decisionRes.data || []).map(log => ({
        type: 'decision' as const,
        data: { ...log, decisions: (log.decisions as unknown) as DecisionEntry[] },
        timestamp: log.created_at,
      }));

      const adjustmentEntries: HistoryEntry[] = (adjustmentRes.data || []).map(adj => ({
        type: 'adjustment' as const,
        data: adj as unknown as AdjustmentLog,
        category: categorizeAdjustment(adj.reason),
        timestamp: adj.created_at,
      }));

      // Merge and sort by timestamp, remove decision duplicates that overlap with adjustments (within 10s)
      const allEntries = [...adjustmentEntries];
      
      // Only add decision logs that don't have a matching adjustment within 10 seconds
      // Also filter out noisy "Not actively cooling" entries
      const filteredResults = new Set(['Not actively cooling', 'Not sustained cooling', 'Lowest not cooling']);
      for (const de of decisionEntries) {
        const log = de.data as DecisionLog;
        if (filteredResults.has(log.final_result)) continue;
        
        const deTime = new Date(de.timestamp).getTime();
        const hasMatchingAdjustment = adjustmentEntries.some(ae => 
          Math.abs(new Date(ae.timestamp).getTime() - deTime) < 10000
        );
        if (!hasMatchingAdjustment) {
          allEntries.push(de);
        }
      }

      allEntries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setEntries(allEntries.slice(0, 30));
    } catch (error) {
      console.error('Error loading logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const getResultIcon = (result: string) => {
    switch (result) {
      case 'pass': return <CheckCircle2 className="h-3 w-3 text-green-500" />;
      case 'fail': return <XCircle className="h-3 w-3 text-red-500" />;
      case 'action': return <Wrench className="h-3 w-3 text-amber-500" />;
      default: return <Info className="h-3 w-3 text-blue-500" />;
    }
  };

  const formatTime = (ts: string) => new Date(ts).toLocaleString('sv-SE', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  if (loading) return <p className="text-sm text-muted-foreground">Laddar...</p>;
  if (entries.length === 0) return <p className="text-sm text-muted-foreground italic">Inga justeringar har gjorts ännu.</p>;

  const filteredEntries = hideSystem ? entries.filter(e => e.type !== 'decision') : entries;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 pb-1">
        <Switch id="hide-system" checked={hideSystem} onCheckedChange={setHideSystem} />
        <Label htmlFor="hide-system" className="text-xs text-muted-foreground cursor-pointer">Dölj systemloggar</Label>
      </div>
      {filteredEntries.length === 0 && (
        <p className="text-sm text-muted-foreground italic">Inga poster att visa.</p>
      )}
      {filteredEntries.map((entry) => {
        if (entry.type === 'adjustment') {
          const adj = entry.data;
          const category = entry.category;
          const aiReasoning = extractAiReasoning(adj.reason);
          const tempChange = adj.new_target_temp - adj.old_target_temp;
          const tempChangeStr = `${tempChange >= 0 ? '+' : ''}${tempChange.toFixed(1)}°`;

          return (
            <Collapsible key={`adj-${adj.id}`}>
              <CollapsibleTrigger className="flex items-center justify-between w-full py-2 px-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-2 text-xs">
                  {getCategoryBadge(category)}
                  <span className="text-muted-foreground">{formatTime(adj.created_at)}</span>
                  <span className="font-medium" style={{ 
                    color: tempChange < 0 ? 'hsl(210 80% 60%)' : tempChange > 0 ? 'hsl(var(--ferment-green))' : undefined 
                  }}>
                    {tempChangeStr}
                  </span>
                  <span className="text-muted-foreground truncate max-w-[80px]">
                    {category === 'glykol' ? adj.cooler_controller_name : (adj.followed_controller_name || adj.cooler_controller_name)}
                  </span>
                </div>
                <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0 transition-transform duration-200" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-1 p-3 bg-background rounded-lg border border-border space-y-2">
                  <div className="flex gap-4 text-[10px] text-muted-foreground pb-2 border-b border-border flex-wrap">
                    <span>Styrenhet: {adj.followed_controller_name || adj.cooler_controller_name}</span>
                    <span>Mål: {r1(adj.old_target_temp)}° → {r1(adj.new_target_temp)}° (probe)</span>
                  </div>
                  
                  {category === 'pill-comp' && (
                    <div className="text-xs space-y-1.5">
                      <p className="font-semibold flex items-center gap-1" style={{ color: 'hsl(280 60% 60%)' }}>
                        🎯 Pill-kompensation
                      </p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                        <div className="text-muted-foreground">Profilmål:</div>
                        <div className="font-medium">{adj.original_target_temp !== null ? `${adj.original_target_temp.toFixed(1)}°` : '—'}</div>
                        <div className="text-muted-foreground">Pill (yta):</div>
                        <div className="font-medium" style={{ color: 'hsl(38 92% 50%)' }}>
                          {adj.followed_current_temp !== null ? `${adj.followed_current_temp.toFixed(1)}°` : '—'}
                        </div>
                        <div className="text-muted-foreground">Probe (styrenhet):</div>
                        <div className="font-medium">
                          {adj.followed_target_temp !== null ? `${adj.followed_target_temp.toFixed(1)}°` : '—'}
                        </div>
                        <div className="text-muted-foreground">Delta / Medel:</div>
                        <div className="font-medium">
                          <span style={{ 
                            color: adj.followed_hysteresis && adj.followed_hysteresis > 2 ? 'hsl(0 80% 60%)' : adj.followed_hysteresis && adj.followed_hysteresis > 1 ? 'hsl(38 92% 50%)' : undefined 
                          }}>
                            {adj.followed_hysteresis !== null ? `+${adj.followed_hysteresis.toFixed(2)}°` : '—'}
                          </span>
                          {' / '}
                          <span>
                            {adj.followed_current_temp !== null && adj.followed_target_temp !== null
                              ? `${((adj.followed_current_temp + adj.followed_target_temp) / 2).toFixed(1)}°`
                              : '—'}
                          </span>
                        </div>
                        <div className="text-muted-foreground">Kompensation:</div>
                        <div className="font-medium">
                          {(() => {
                            const change = adj.new_target_temp - adj.old_target_temp;
                            const sign = change >= 0 ? '+' : '';
                            return `${sign}${change.toFixed(1)}°`;
                          })()}
                          {adj.original_target_temp != null && (
                            <span className="text-muted-foreground ml-1">
                              (totalt {(adj.original_target_temp - adj.new_target_temp).toFixed(1)}° under profil)
                            </span>
                          )}
                        </div>
                      </div>
                      {/* D-term data parsed from reason string */}
                      {(() => {
                        const reason = adj.reason || '';
                        const rateMatch = reason.match(/rate=([-\d.]+)°\/h/);
                        const etaMatch = reason.match(/ETA=(\d+)min/);
                        const dampMatch = reason.match(/damp=([\d.]+)/);
                        // New format: PI=+X.XX°C(P=X.XX,I=X.XX,learned=X.XX[bucket]n=N)
                        const piMatch = reason.match(/PI=\+([\d.]+)°C\(P=([\d.]+),I=([\d.]+)(?:,learned=([\d.]+)\[(\w+)\]n=(\d+))?\)/);
                        const pTermMatch = !piMatch ? reason.match(/P-term=\+([\d.]+)°C/) : null;
                        const rate = rateMatch ? parseFloat(rateMatch[1]) : null;
                        const eta = etaMatch ? parseInt(etaMatch[1]) : null;
                        const damp = dampMatch ? parseFloat(dampMatch[1]) : null;
                        const piTotal = piMatch ? parseFloat(piMatch[1]) : (pTermMatch ? parseFloat(pTermMatch[1]) : null);
                        const pVal = piMatch ? parseFloat(piMatch[2]) : piTotal;
                        const iVal = piMatch ? parseFloat(piMatch[3]) : null;
                        const learnedVal = piMatch && piMatch[4] ? parseFloat(piMatch[4]) : null;
                        const learnedBucket = piMatch && piMatch[5] ? piMatch[5] : null;
                        const learnedN = piMatch && piMatch[6] ? parseInt(piMatch[6]) : null;
                        // Calculate average distance to profile target
                        const avgTemp = adj.followed_current_temp !== null && adj.followed_target_temp !== null
                          ? (adj.followed_current_temp + adj.followed_target_temp) / 2 : null;
                        const profileTarget = adj.original_target_temp;
                        const avgDistance = avgTemp !== null && profileTarget !== null ? avgTemp - profileTarget : null;
                        
                        const bucketLabels: Record<string, string> = { 'high': 'Aktiv (>3°)', 'medium': 'Mellan (1.5-3°)', 'low': 'Lugn (<1.5°)' };
                        
                        return (
                          <div className="mt-1.5 pt-1.5 border-t border-border/50">
                            <p className="font-semibold text-[10px] mb-1" style={{ color: 'hsl(200 70% 55%)' }}>
                              🧮 PID-reglering
                            </p>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
                              <div className="text-muted-foreground">Medel → Mål:</div>
                              <div className="font-medium">
                                {avgTemp !== null && profileTarget !== null ? (
                                  <>
                                    <span>{avgTemp.toFixed(1)}° → {profileTarget.toFixed(1)}°</span>
                                    <span className="ml-1" style={{ 
                                      color: avgDistance! > 0.5 ? 'hsl(38 92% 50%)' : avgDistance! < -0.5 ? 'hsl(var(--temp-blue))' : 'hsl(var(--ferment-green))' 
                                    }}>
                                      ({avgDistance! >= 0 ? '+' : ''}{avgDistance!.toFixed(1)}°)
                                    </span>
                                  </>
                                ) : '—'}
                              </div>
                              {piTotal !== null && piTotal > 0 && (
                                <>
                                  <div className="text-muted-foreground">PI-korrigering:</div>
                                  <div className="font-medium" style={{ color: 'hsl(var(--ferment-green))' }}>
                                    +{piTotal.toFixed(2)}°C
                                    {pVal !== null && iVal !== null && (
                                      <span className="text-muted-foreground ml-1">
                                        (P={pVal.toFixed(2)} I={iVal.toFixed(2)})
                                      </span>
                                    )}
                                  </div>
                                </>
                              )}
                              {learnedVal !== null && learnedVal > 0 && (
                                <>
                                  <div className="text-muted-foreground">Inlärd baseline:</div>
                                  <div className="font-medium" style={{ color: 'hsl(280 60% 60%)' }}>
                                    {learnedVal.toFixed(2)}°C
                                    <span className="text-muted-foreground ml-1">
                                      ({bucketLabels[learnedBucket || ''] || learnedBucket}, {learnedN} ggr)
                                    </span>
                                  </div>
                                </>
                              )}
                              {rate !== null && (
                                <>
                                  <div className="text-muted-foreground">Pill-hastighet:</div>
                                  <div className="font-medium" style={{ color: rate < 0 ? 'hsl(var(--temp-blue))' : rate > 0 ? 'hsl(38 92% 50%)' : undefined }}>
                                    {rate >= 0 ? '+' : ''}{rate.toFixed(2)}°C/h
                                  </div>
                                </>
                              )}
                              {eta !== null && (
                                <>
                                  <div className="text-muted-foreground">ETA till mål:</div>
                                  <div className="font-medium">{eta} min</div>
                                </>
                              )}
                              {damp !== null && (
                                <>
                                  <div className="text-muted-foreground">Dämpning:</div>
                                  <div className="font-medium" style={{ color: damp < 1.0 ? 'hsl(200 70% 55%)' : 'hsl(var(--muted-foreground))' }}>
                                    {damp < 1.0 ? `${(damp * 100).toFixed(0)}% (aktiv)` : '100% (full komp)'}
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                      <p className="text-[10px] text-muted-foreground mt-1 italic">
                        Justerar styrenhetens mål (probe) så att medelvärdet av pill (yta) och probe (kärna) hamnar på profilmålet
                      </p>
                    </div>
                  )}

                  {category === 'profil' && (
                    <div className="text-xs space-y-1.5">
                      <p className="font-semibold flex items-center gap-1" style={{ color: 'hsl(160 60% 45%)' }}>
                        🔧 Fermenteringsprofil
                      </p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                        <div className="text-muted-foreground">Controller:</div>
                        <div className="font-medium">{adj.cooler_controller_name}</div>
                        {adj.original_target_temp !== null && (
                          <>
                            <div className="text-muted-foreground">Profilmål:</div>
                            <div className="font-medium">{adj.original_target_temp.toFixed(1)}°</div>
                          </>
                        )}
                        <div className="text-muted-foreground">Tankmål:</div>
                        <div className="font-medium">{r1(adj.old_target_temp)}° → {r1(adj.new_target_temp)}°</div>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1 italic">{adj.reason}</p>
                    </div>
                  )}

                  {category === 'glykol' && (
                    <div className="text-xs space-y-1.5">
                      <p className="font-semibold flex items-center gap-1" style={{ color: 'hsl(210 80% 60%)' }}>
                        ❄️ Glykolkylare
                      </p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                        <div className="text-muted-foreground">Styrande tank:</div>
                        <div className="font-medium">{adj.followed_controller_name || '—'}</div>
                        {adj.followed_current_temp !== null && (
                          <>
                            <div className="text-muted-foreground">Tank aktuell:</div>
                            <div className="font-medium">{adj.followed_current_temp.toFixed(1)}°</div>
                          </>
                        )}
                        {adj.followed_target_temp !== null && (
                          <>
                            <div className="text-muted-foreground">Tank mål:</div>
                            <div className="font-medium">{adj.followed_target_temp.toFixed(1)}°</div>
                          </>
                        )}
                        <div className="text-muted-foreground">Kylare:</div>
                        <div className="font-medium">{r1(adj.old_target_temp)}° → {r1(adj.new_target_temp)}°</div>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1 italic">{adj.reason}</p>
                    </div>
                  )}

                </div>
              </CollapsibleContent>
            </Collapsible>
          );
        }

        // Decision log entry (fallback for entries without matching adjustment)
        const log = entry.data as DecisionLog;
        return (
          <Collapsible key={`dec-${log.id}`}>
            <CollapsibleTrigger className="flex items-center justify-between w-full py-2 px-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-2 text-xs">
                <Badge variant="default" className="text-[10px] px-1.5" style={{ 
                  background: 'hsl(var(--primary) / 0.2)', 
                  color: 'hsl(var(--primary))', 
                  borderColor: 'hsl(var(--primary) / 0.3)' 
                }}>
                  System
                </Badge>
                <span className="text-muted-foreground">{formatTime(log.created_at)}</span>
                <span className="font-medium truncate max-w-[120px]">{log.final_result}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">{log.duration_ms}ms</span>
                <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200" />
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-1 p-3 bg-background rounded-lg border border-border space-y-2">
                <div className="flex gap-4 text-[10px] text-muted-foreground pb-2 border-b border-border">
                  <span>Steg: {log.decision_count}</span>
                  <span>Tid: {log.duration_ms}ms</span>
                  <span>Resultat: {log.final_result}</span>
                </div>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {log.decisions.map((decision, index) => (
                    <div key={index} className="flex items-start gap-2 text-[11px]">
                      <div className="mt-0.5 flex-shrink-0">{getResultIcon(decision.result)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex gap-2">
                          <span className="font-mono text-muted-foreground text-[10px]">{decision.step}</span>
                          <span className="text-foreground truncate">{decision.message}</span>
                        </div>
                        {decision.details && Object.keys(decision.details).length > 0 && (
                          <div className="mt-0.5 text-[10px] text-muted-foreground font-mono pl-2 border-l border-border ml-1">
                            {Object.entries(decision.details).map(([key, value]) => (
                              <div key={key}>{key}: {typeof value === 'object' ? JSON.stringify(value) : String(value)}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}
