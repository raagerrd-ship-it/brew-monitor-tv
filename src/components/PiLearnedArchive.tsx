import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Copy, Download, RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type Row = {
  controller_id: string;
  mode: string;
  parameter_name: string;
  value: number;
  samples: number;
  param_updated_at: number;
};

const MODE_LABELS: Record<string, string> = { cooling: "Kyla", heating: "Värme" };

function buildExport(rows: Row[]) {
  const out: Record<string, Record<string, unknown>> = {};
  for (const r of rows) {
    (out[r.mode] ??= {})[r.parameter_name] = {
      value: Number(r.value),
      samples: r.samples,
      updated_at: Number(r.param_updated_at),
    };
  }
  return out;
}

export function PiLearnedArchive() {
  const [rows, setRows] = useState<Row[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const [{ data: params }, { data: controllers }] = await Promise.all([
      supabase
        .from("pi_learned_params")
        .select("controller_id, mode, parameter_name, value, samples, param_updated_at"),
      supabase.from("rapt_temp_controllers").select("controller_id, name"),
    ]);
    setRows((params ?? []).map((p) => ({ ...p, value: Number(p.value), param_updated_at: Number(p.param_updated_at) })));
    setNames(Object.fromEntries((controllers ?? []).map((c) => [c.controller_id, c.name])));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">Inget inlärt värde arkiverat ännu.</p>;
  }

  const byController = rows.reduce<Record<string, Row[]>>((acc, r) => {
    (acc[r.controller_id] ??= []).push(r);
    return acc;
  }, {});

  const copy = async (id: string, items: Row[]) => {
    await navigator.clipboard.writeText(JSON.stringify(buildExport(items), null, 2));
    toast({ title: "Kopierat", description: `Inlärda värden för ${names[id] ?? id.slice(0, 8)}` });
  };

  const download = (id: string, items: Row[]) => {
    const blob = new Blob([JSON.stringify(buildExport(items), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `learned-${id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={load}>
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>

      {Object.entries(byController).map(([id, items]) => (
        <div key={id} className="rounded-xl border border-border/40 p-3 space-y-2 bg-card/60">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">{names[id] ?? id.slice(0, 8)}</span>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => copy(id, items)}>
                <Copy className="h-3 w-3 mr-1" />Kopiera
              </Button>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => download(id, items)}>
                <Download className="h-3 w-3 mr-1" />JSON
              </Button>
            </div>
          </div>

          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                <th className="text-left py-1">Läge</th>
                <th className="text-left py-1">Parameter</th>
                <th className="text-right py-1">Värde</th>
                <th className="text-right py-1">Prov</th>
                <th className="text-right py-1">Uppdaterad</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={`${r.mode}-${r.parameter_name}`} className="border-t border-border/20">
                  <td className="py-1">{MODE_LABELS[r.mode] ?? r.mode}</td>
                  <td className="py-1 font-mono">{r.parameter_name}</td>
                  <td className="py-1 text-right font-mono">{r.value}</td>
                  <td className="py-1 text-right text-muted-foreground">{r.samples}</td>
                  <td className="py-1 text-right text-muted-foreground">
                    {new Date(r.param_updated_at * 1000).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}