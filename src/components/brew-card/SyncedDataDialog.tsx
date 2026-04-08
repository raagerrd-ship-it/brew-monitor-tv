import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import { Flame, Snowflake } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface SnapshotRow {
  recorded_at: string;
  sg: number | null;
  pill_temp: number | null;
  controller_temp: number | null;
  profile_target_temp: number | null;
  auto_target_temp: number | null;
}

interface SyncedDataDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brewName: string;
  brewId: string;
  controllerId?: string | null;
}

export function SyncedDataDialog({
  open,
  onOpenChange,
  brewName,
  brewId,
  controllerId,
}: SyncedDataDialogProps) {
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [controllerStatus, setControllerStatus] = useState<{
    heating_enabled: boolean | null;
    cooling_enabled: boolean | null;
    dual_sensor_enabled: boolean | null;
  } | null>(null);

  const fetchSnapshots = useCallback(async (silent = false) => {
    if (!brewId) return;

    if (!silent) setLoading(true);

    try {
      // Thinning policy caps snapshots at ~500 per brew, no pagination needed
      const { data, error } = await supabase
        .from("brew_data_snapshots")
        .select("recorded_at, sg, pill_temp, controller_temp, profile_target_temp, auto_target_temp")
        .eq("brew_id", brewId)
        .order("recorded_at", { ascending: false });

      if (error) {
        console.error("[SyncedDataDialog] Failed to fetch snapshots:", error);
      }

      setSnapshots((data as SnapshotRow[]) ?? []);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [brewId]);

  // Fetch controller heating/cooling status
  useEffect(() => {
    if (!open || !controllerId) {
      setControllerStatus(null);
      return;
    }

    const fetchStatus = async () => {
      const { data } = await supabase
        .from("rapt_temp_controllers")
        .select("heating_enabled, cooling_enabled, dual_sensor_enabled")
        .eq("controller_id", controllerId)
        .maybeSingle();
      if (data) setControllerStatus(data);
    };

    fetchStatus();

    const channel = supabase
      .channel(`synced-dialog-ctrl-${controllerId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'rapt_temp_controllers',
        filter: `controller_id=eq.${controllerId}`,
      }, (payload) => {
        const p = payload.new as any;
        setControllerStatus({
          heating_enabled: p.heating_enabled,
          cooling_enabled: p.cooling_enabled,
          dual_sensor_enabled: p.dual_sensor_enabled,
        });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [open, controllerId]);

  useEffect(() => {
    if (!open || !brewId) {
      setSnapshots([]);
      setLoading(false);
      return;
    }

    fetchSnapshots(false);

    const intervalId = window.setInterval(() => {
      fetchSnapshots(true);
    }, 15000);

    return () => window.clearInterval(intervalId);
  }, [open, brewId, fetchSnapshots]);

  const hasControllerData = !!controllerId && snapshots.some((s) => s.controller_temp != null);
  const hasAvgTemp = hasControllerData && snapshots.some((s) => {
    if (controllerStatus?.dual_sensor_enabled === false) {
      return s.pill_temp != null || s.auto_target_temp != null;
    }
    return s.auto_target_temp != null;
  });

  const getDisplayActualTemp = useCallback((point: SnapshotRow) => {
    if (controllerStatus?.dual_sensor_enabled === false) {
      return point.pill_temp ?? point.auto_target_temp;
    }
    return point.auto_target_temp;
  }, [controllerStatus?.dual_sensor_enabled]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] px-3 sm:px-4">
        <DialogHeader>
          <DialogTitle>Synkad data - {brewName}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted-foreground">
            {snapshots.length} mätpunkter
          </span>
          {controllerStatus && (
            <div className="flex gap-1.5">
              <Badge
                variant="outline"
                className={`text-[10px] px-1.5 py-0 gap-1 ${
                  controllerStatus.heating_enabled
                    ? 'border-orange-500/40 text-orange-500'
                    : 'border-border/40 text-muted-foreground/40'
                }`}
              >
                <Flame className="w-3 h-3" />
                {controllerStatus.heating_enabled ? 'På' : 'Av'}
              </Badge>
              <Badge
                variant="outline"
                className={`text-[10px] px-1.5 py-0 gap-1 ${
                  controllerStatus.cooling_enabled
                    ? 'border-blue-500/40 text-blue-500'
                    : 'border-border/40 text-muted-foreground/40'
                }`}
              >
                <Snowflake className="w-3 h-3" />
                {controllerStatus.cooling_enabled ? 'På' : 'Av'}
              </Badge>
            </div>
          )}
        </div>
        <ScrollArea className="h-[400px] pr-2">
          <div className="space-y-1">
            {loading ? (
              <p className="text-muted-foreground text-center py-8">Laddar...</p>
            ) : snapshots.length === 0 ? (
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
                    {hasAvgTemp && (
                      <th className="text-right py-2 font-medium">Snitt</th>
                    )}
                    {hasControllerData && (
                      <th className="text-right py-2 font-medium">Ctrl</th>
                    )}
                    {hasControllerData && (
                      <th className="text-right py-2 font-medium">Mål</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((point, index) => {
                    const displayActual = getDisplayActualTemp(point);
                    return (
                      <tr
                        key={point.recorded_at}
                        className={`border-b border-border/50 ${
                          index === 0 ? "bg-primary/5" : ""
                        }`}
                      >
                        <td className="py-1.5 text-muted-foreground">
                          {format(new Date(point.recorded_at), "d MMM HH:mm", { locale: sv })}
                        </td>
                        <td className={`py-1.5 text-right font-mono ${point.sg != null ? 'text-beer-amber' : 'text-muted-foreground/40'}`}>
                          {point.sg != null ? point.sg.toFixed(4) : "-"}
                        </td>
                        <td className={`py-1.5 text-right font-mono ${point.pill_temp != null ? 'text-foreground' : 'text-muted-foreground/40'}`}>
                          {point.pill_temp != null ? `${point.pill_temp.toFixed(2)}°` : "-"}
                        </td>
                        {hasAvgTemp && (
                          <td className={`py-1.5 text-right font-mono ${displayActual != null ? 'text-temp-blue' : 'text-muted-foreground/40'}`}>
                            {displayActual != null
                              ? `${displayActual.toFixed(2)}°`
                              : "-"}
                          </td>
                        )}
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
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
