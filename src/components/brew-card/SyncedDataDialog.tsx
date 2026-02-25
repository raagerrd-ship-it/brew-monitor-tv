import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";

interface SnapshotRow {
  recorded_at: string;
  sg: number | null;
  pill_temp: number | null;
  controller_temp: number | null;
  profile_target_temp: number | null;
  auto_target_temp: number | null;
  isLive?: boolean;
}

interface SyncedDataDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brewName: string;
  brewId: string;
  controllerId?: string | null;
  liveSnapshot?: SnapshotRow | null;
}

function differs(a: number | null, b: number | null): boolean {
  if (a == null && b == null) return false;
  if (a == null || b == null) return true;
  return Math.abs(a - b) > 0.05;
}

export function SyncedDataDialog({
  open,
  onOpenChange,
  brewName,
  brewId,
  controllerId,
  liveSnapshot,
}: SyncedDataDialogProps) {
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchSnapshots = useCallback(async (silent = false) => {
    if (!brewId) return;

    if (!silent) setLoading(true);

    try {
      const allSnapshots: SnapshotRow[] = [];
      let offset = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from("brew_data_snapshots")
          .select("recorded_at, sg, pill_temp, controller_temp, profile_target_temp, auto_target_temp")
          .eq("brew_id", brewId)
          .order("recorded_at", { ascending: false })
          .range(offset, offset + batchSize - 1);

        if (error || !data || data.length === 0) {
          hasMore = false;
        } else {
          allSnapshots.push(...data);
          offset += batchSize;
          hasMore = data.length === batchSize;
        }
      }

      setSnapshots(allSnapshots);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [brewId]);

  useEffect(() => {
    if (!open || !brewId) {
      setSnapshots([]);
      setLoading(false);
      return;
    }

    fetchSnapshots(false);

    // Keep dialog fresh while open
    const intervalId = window.setInterval(() => {
      fetchSnapshots(true);
    }, 15000);

    return () => window.clearInterval(intervalId);
  }, [open, brewId, fetchSnapshots]);

  const displayedRows = useMemo(() => {
    if (!liveSnapshot) return snapshots;

    const first = snapshots[0];
    if (!first) {
      return [{ ...liveSnapshot, isLive: true }];
    }

    const timeGapMs = Math.abs(
      new Date(liveSnapshot.recorded_at).getTime() - new Date(first.recorded_at).getTime(),
    );

    const shouldPrependLive =
      timeGapMs > 60 * 1000 ||
      differs(first.profile_target_temp, liveSnapshot.profile_target_temp) ||
      differs(first.auto_target_temp, liveSnapshot.auto_target_temp);

    return shouldPrependLive ? [{ ...liveSnapshot, isLive: true }, ...snapshots] : snapshots;
  }, [snapshots, liveSnapshot]);

  const hasControllerData = !!controllerId && displayedRows.some((s) => s.controller_temp != null);
  const hasAutoAdjustments = hasControllerData && displayedRows.some(
    (s) => s.auto_target_temp != null && s.profile_target_temp != null &&
      Math.abs((s.auto_target_temp ?? 0) - (s.profile_target_temp ?? 0)) > 0.05,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] px-3 sm:px-4">
        <DialogHeader>
          <DialogTitle>Synkad data - {brewName}</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-muted-foreground mb-2">
          {snapshots.length} mätpunkter
        </div>
        <ScrollArea className="h-[400px] pr-2">
          <div className="space-y-1">
            {loading ? (
              <p className="text-muted-foreground text-center py-8">Laddar...</p>
            ) : displayedRows.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                Ingen synkad data ännu
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b">
                    <th className="text-left py-2 font-medium">Datum</th>
                    <th className="text-right py-2 font-medium">SG</th>
                    <th className="text-right py-2 font-medium">Pill</th>
                    {hasControllerData && (
                      <th className="text-right py-2 font-medium">Ctrl</th>
                    )}
                    {hasControllerData && (
                      <th className="text-right py-2 font-medium">Mål</th>
                    )}
                    {hasAutoAdjustments && (
                      <th className="text-right py-2 font-medium">PID</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {displayedRows.map((point, index) => (
                    <tr
                      key={`${point.recorded_at}-${point.isLive ? 'live' : 'snap'}`}
                      className={`border-b border-border/50 ${
                        index === 0 ? "bg-primary/5" : ""
                      }`}
                    >
                      <td className="py-1.5 text-muted-foreground">
                        {point.isLive
                          ? `Nu ${format(new Date(point.recorded_at), "HH:mm:ss", { locale: sv })}`
                          : format(new Date(point.recorded_at), "d MMM HH:mm", { locale: sv })}
                      </td>
                      <td className="py-1.5 text-right font-mono text-beer-amber">
                        {point.sg != null ? point.sg.toFixed(4) : "-"}
                      </td>
                      <td className="py-1.5 text-right font-mono text-temp-blue">
                        {point.pill_temp != null ? `${point.pill_temp.toFixed(1)}°` : "-"}
                      </td>
                      {hasControllerData && (
                        <td className="py-1.5 text-right font-mono text-foreground">
                          {point.controller_temp != null
                            ? `${point.controller_temp.toFixed(1)}°`
                            : "-"}
                        </td>
                      )}
                      {hasControllerData && (
                        <td className="py-1.5 text-right font-mono text-muted-foreground">
                          {point.profile_target_temp != null
                            ? `${point.profile_target_temp.toFixed(1)}°`
                            : "-"}
                        </td>
                      )}
                      {hasAutoAdjustments && (
                        <td className="py-1.5 text-right font-mono text-muted-foreground/60">
                          {point.auto_target_temp != null
                            ? `${point.auto_target_temp.toFixed(1)}°`
                            : "-"}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
