import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { sv } from "date-fns/locale/sv";
import { Bot, ChevronDown, Check, Minus } from "lucide-react";
import type { Json } from "@/integrations/supabase/types";

interface AuditEntry {
  id: string;
  created_at: string;
  model: string;
  duration_ms: number;
  prompt_summary: string | null;
  actions_taken: Json;
  parameters_changed: Json;
  analysis: string;
}

interface ParamChange {
  parameter?: string;
  old_value?: number | string;
  new_value?: number | string;
  reason?: string;
  table?: string;
  controller_id?: string | null;
}

export function AiAuditHistory() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase
        .from("ai_audit_log")
        .select("id, created_at, model, duration_ms, prompt_summary, actions_taken, parameters_changed, analysis")
        .order("created_at", { ascending: false })
        .limit(20);
      setEntries((data as AuditEntry[]) || []);
      setLoading(false);
    }
    fetch();
  }, []);

  if (loading) {
    return <div className="text-xs text-muted-foreground py-4 text-center">Laddar…</div>;
  }

  if (entries.length === 0) {
    return <div className="text-xs text-muted-foreground py-4 text-center">Ingen AI-historik ännu</div>;
  }

  return (
    <div className="space-y-1">
      {entries.map((entry) => {
        const params = Array.isArray(entry.parameters_changed) ? entry.parameters_changed as unknown as ParamChange[] : [];
        const hasChanges = params.length > 0;
        const isExpanded = expandedId === entry.id;
        const ago = formatDistanceToNow(new Date(entry.created_at), { addSuffix: false, locale: sv });
        const modelShort = entry.model?.split("/").pop() || "?";

        return (
          <div key={entry.id} className="rounded-md border border-border/30 overflow-hidden">
            {/* Header row */}
            <button
              onClick={() => setExpandedId(isExpanded ? null : entry.id)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/20 transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                <span className="text-[11px] text-muted-foreground truncate">{ago} sedan</span>
                {hasChanges ? (
                  <span className="text-[10px] font-medium text-accent bg-accent/10 px-1.5 py-0.5 rounded">
                    {params.length} ändr.
                  </span>
                ) : (
                  <span className="text-[10px] text-muted-foreground/50 flex items-center gap-0.5">
                    <Minus className="h-2.5 w-2.5" /> inga ändringar
                  </span>
                )}
              </div>
              <ChevronDown className={`h-3 w-3 shrink-0 text-muted-foreground/40 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
            </button>

            {/* Expanded details */}
            {isExpanded && (
              <div className="px-3 pb-3 space-y-2 border-t border-border/20">
                {/* Parameter changes */}
                {hasChanges && (
                  <div className="space-y-1 pt-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Parameterändringar</span>
                    {params.map((p, i) => (
                      <div key={i} className="space-y-0.5">
                        <div className="flex items-start gap-1.5 text-[11px]">
                          <Check className="h-3 w-3 shrink-0 text-green-400 mt-0.5" />
                          <div className="min-w-0">
                            <span className="font-medium text-foreground/80">{p.parameter || '?'}</span>
                            <span className="text-muted-foreground ml-1.5">{String(p.old_value ?? '')} → {String(p.new_value ?? '')}</span>
                            {p.table && p.table !== 'auto_cooling_settings' && (
                              <span className="text-muted-foreground/40 ml-1 text-[10px]">({p.table})</span>
                            )}
                          </div>
                        </div>
                        {p.reason && (
                          <p className="text-[10px] text-muted-foreground/50 pl-[18px] leading-tight">{p.reason}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Analysis */}
                {entry.analysis && (
                  <div className="pt-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Analys</span>
                    <p className="text-[11px] text-muted-foreground/70 leading-relaxed whitespace-pre-wrap mt-0.5">
                      {entry.analysis}
                    </p>
                  </div>
                )}

                {/* Meta */}
                <div className="flex items-center gap-3 text-[9px] text-muted-foreground/30 pt-1">
                  <span>{modelShort}</span>
                  <span>{entry.duration_ms}ms</span>
                  {entry.prompt_summary && <span>{entry.prompt_summary}</span>}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
