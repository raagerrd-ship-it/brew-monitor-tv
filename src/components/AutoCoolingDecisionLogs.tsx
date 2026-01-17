import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, CheckCircle2, XCircle, Info, Wrench } from "lucide-react";
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

export function AutoCoolingDecisionLogs() {
  const [logs, setLogs] = useState<DecisionLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLogs();

    const channel = supabase
      .channel('decision-logs')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'auto_cooling_decision_logs'
        },
        () => {
          loadLogs();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const loadLogs = async () => {
    try {
      const { data, error } = await supabase
        .from('auto_cooling_decision_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;

      // Cast the data to our type since decisions is JSONB
      const typedData = (data || []).map(log => ({
        ...log,
        decisions: (log.decisions as unknown) as DecisionEntry[]
      }));

      setLogs(typedData);
    } catch (error) {
      console.error('Error loading decision logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const getResultIcon = (result: string) => {
    switch (result) {
      case 'pass':
        return <CheckCircle2 className="h-3 w-3 text-green-500" />;
      case 'fail':
        return <XCircle className="h-3 w-3 text-red-500" />;
      case 'action':
        return <Wrench className="h-3 w-3 text-amber-500" />;
      default:
        return <Info className="h-3 w-3 text-blue-500" />;
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Laddar...</p>;
  }

  if (logs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        Inga beslut loggade ännu. Beslut loggas automatiskt vid varje kontroll.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {logs.map((log) => (
        <Collapsible key={log.id}>
          <CollapsibleTrigger className="flex items-center justify-between w-full py-2 px-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-2 text-xs">
              {log.adjustment_made ? (
                <Badge variant="default" className="bg-amber-500/20 text-amber-500 border-amber-500/30 text-[10px] px-1.5">
                  Justering
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] px-1.5">
                  Ingen ändring
                </Badge>
              )}
              <span className="text-muted-foreground">
                {new Date(log.created_at).toLocaleString('sv-SE', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </span>
              <span className="font-medium truncate max-w-[120px]">
                {log.final_result}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">
                {log.duration_ms}ms
              </span>
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
                    <div className="mt-0.5 flex-shrink-0">
                      {getResultIcon(decision.result)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex gap-2">
                        <span className="font-mono text-muted-foreground text-[10px]">
                          {decision.step}
                        </span>
                        <span className="text-foreground truncate">
                          {decision.message}
                        </span>
                      </div>
                      {decision.details && Object.keys(decision.details).length > 0 && (
                        <div className="mt-0.5 text-[10px] text-muted-foreground font-mono pl-2 border-l border-border ml-1">
                          {Object.entries(decision.details).map(([key, value]) => (
                            <div key={key}>
                              {key}: {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                            </div>
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
      ))}
    </div>
  );
}
