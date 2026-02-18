import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, CheckCircle2, XCircle, Info, Wrench, Thermometer, TrendingUp, Snowflake } from "lucide-react";
import { Badge } from "@/components/ui/badge";

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
  cooler_controller_name: string;
  followed_controller_name: string | null;
  followed_current_temp: number | null;
  followed_target_temp: number | null;
}

type HistoryEntry = 
  | { type: 'decision'; data: DecisionLog; timestamp: string }
  | { type: 'adjustment'; data: AdjustmentLog; category: 'cooling' | 'overshoot' | 'stall'; timestamp: string };

function categorizeAdjustment(reason: string): 'overshoot' | 'stall' | 'cooling' {
  if (reason.startsWith('🌡️')) return 'overshoot';
  if (reason.startsWith('🧠')) return 'stall';
  return 'cooling';
}

function getCategoryBadge(category: 'cooling' | 'overshoot' | 'stall') {
  switch (category) {
    case 'overshoot':
      return (
        <Badge variant="default" className="text-[10px] px-1.5" style={{ 
          background: 'hsl(38 92% 50% / 0.2)', 
          color: 'hsl(38 92% 50%)', 
          borderColor: 'hsl(38 92% 50% / 0.3)' 
        }}>
          <Thermometer className="h-2.5 w-2.5 mr-0.5" />
          Overshoot
        </Badge>
      );
    case 'stall':
      return (
        <Badge variant="default" className="text-[10px] px-1.5" style={{ 
          background: 'hsl(var(--ferment-green) / 0.2)', 
          color: 'hsl(var(--ferment-green))', 
          borderColor: 'hsl(var(--ferment-green) / 0.3)' 
        }}>
          <TrendingUp className="h-2.5 w-2.5 mr-0.5" />
          Stall
        </Badge>
      );
    default:
      return (
        <Badge variant="default" className="text-[10px] px-1.5" style={{ 
          background: 'hsl(210 80% 60% / 0.2)', 
          color: 'hsl(210 80% 60%)', 
          borderColor: 'hsl(210 80% 60% / 0.3)' 
        }}>
          <Snowflake className="h-2.5 w-2.5 mr-0.5" />
          Kylning
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
      for (const de of decisionEntries) {
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

  return (
    <div className="space-y-2">
      {entries.map((entry) => {
        if (entry.type === 'adjustment') {
          const adj = entry.data;
          const category = entry.category;
          const aiReasoning = extractAiReasoning(adj.reason);
          const tempChange = adj.new_target_temp - adj.old_target_temp;
          const tempChangeStr = `${tempChange >= 0 ? '+' : ''}${tempChange.toFixed(1)}°C`;

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
                    {adj.followed_controller_name || adj.cooler_controller_name}
                  </span>
                </div>
                <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0 transition-transform duration-200" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-1 p-3 bg-background rounded-lg border border-border space-y-2">
                  <div className="flex gap-4 text-[10px] text-muted-foreground pb-2 border-b border-border flex-wrap">
                    <span>Controller: {adj.followed_controller_name || adj.cooler_controller_name}</span>
                    <span>{adj.old_target_temp}° → {adj.new_target_temp}°</span>
                    {adj.followed_current_temp !== null && <span>Aktuell: {adj.followed_current_temp.toFixed(1)}°</span>}
                  </div>
                  
                  {aiReasoning && (
                    <div className="text-xs space-y-1">
                      <p className="font-semibold flex items-center gap-1" style={{ 
                        color: category === 'overshoot' ? 'hsl(38 92% 50%)' : 'hsl(var(--ferment-green))' 
                      }}>
                        {category === 'overshoot' ? '🌡️' : '🧠'} AI-rekommendation
                      </p>
                      <p className="text-muted-foreground leading-relaxed">{aiReasoning}</p>
                    </div>
                  )}
                  
                  {!aiReasoning && (
                    <p className="text-[11px] text-muted-foreground">{adj.reason}</p>
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
