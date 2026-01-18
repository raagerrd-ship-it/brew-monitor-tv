import { useState, useEffect, useMemo } from "react";
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

interface SgDataPoint {
  date: string;
  value: number;
  temp: number;
}

interface ControllerTempPoint {
  recorded_at: string;
  current_temp: number;
  target_temp: number;
}

interface MergedDataPoint {
  date: string;
  sg: number;
  pillTemp: number;
  controllerTemp: number | null;
  targetTemp: number | null;
}

interface SyncedDataDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brewName: string;
  sgData: SgDataPoint[];
  controllerId?: string | null;
}

export function SyncedDataDialog({
  open,
  onOpenChange,
  brewName,
  sgData,
  controllerId,
}: SyncedDataDialogProps) {
  const [controllerData, setControllerData] = useState<ControllerTempPoint[]>([]);

  // Fetch controller temperature data when dialog opens
  useEffect(() => {
    if (!open || !controllerId || sgData.length === 0) {
      setControllerData([]);
      return;
    }

    const fetchControllerTemp = async () => {
      const sortedSg = [...sgData].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      );
      const startTime = sortedSg[0].date;
      const endTime = sortedSg[sortedSg.length - 1].date;

      const { data, error } = await supabase.rpc("get_temp_history_sampled", {
        p_controller_id: controllerId,
        p_start_time: startTime,
        p_end_time: endTime,
        p_sample_interval_minutes: 15,
      });

      if (!error && data) {
        setControllerData(data);
      }
    };

    fetchControllerTemp();
  }, [open, controllerId, sgData]);

  // Merge sg_data with controller temp data
  const mergedData = useMemo(() => {
    // Create a map of controller temps by timestamp (rounded to 15 min)
    const controllerMap = new Map<number, ControllerTempPoint>();
    controllerData.forEach((c) => {
      const ts = Math.floor(new Date(c.recorded_at).getTime() / (15 * 60 * 1000));
      controllerMap.set(ts, c);
    });

    // Merge with sg_data
    const merged: MergedDataPoint[] = sgData.map((point) => {
      const pointTs = Math.floor(new Date(point.date).getTime() / (15 * 60 * 1000));
      
      // Find closest controller reading (within 15 min window)
      let closest: ControllerTempPoint | null = null;
      for (let offset = 0; offset <= 1; offset++) {
        if (controllerMap.has(pointTs + offset)) {
          closest = controllerMap.get(pointTs + offset)!;
          break;
        }
        if (controllerMap.has(pointTs - offset)) {
          closest = controllerMap.get(pointTs - offset)!;
          break;
        }
      }

      return {
        date: point.date,
        sg: point.value,
        pillTemp: point.temp,
        controllerTemp: closest?.current_temp ?? null,
        targetTemp: closest?.target_temp ?? null,
      };
    });

    // Sort by date descending
    return merged.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }, [sgData, controllerData]);

  const hasControllerData = controllerId && controllerData.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Synkad data - {brewName}</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-muted-foreground mb-2">
          {sgData.length} mätpunkter
        </div>
        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-1">
            {mergedData.length === 0 ? (
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
                      <>
                        <th className="text-right py-2 font-medium">Ctrl</th>
                        <th className="text-right py-2 font-medium">Mål</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {mergedData.map((point, index) => (
                    <tr
                      key={point.date}
                      className={`border-b border-border/50 ${
                        index === 0 ? "bg-primary/5" : ""
                      }`}
                    >
                      <td className="py-1.5 text-muted-foreground">
                        {format(new Date(point.date), "d MMM HH:mm", {
                          locale: sv,
                        })}
                      </td>
                      <td className="py-1.5 text-right font-mono text-beer-amber">
                        {point.sg.toFixed(3)}
                      </td>
                      <td className="py-1.5 text-right font-mono text-temp-blue">
                        {point.pillTemp.toFixed(1)}°
                      </td>
                      {hasControllerData && (
                        <>
                          <td className="py-1.5 text-right font-mono text-orange-400">
                            {point.controllerTemp !== null
                              ? `${point.controllerTemp.toFixed(1)}°`
                              : "-"}
                          </td>
                          <td className="py-1.5 text-right font-mono text-muted-foreground">
                            {point.targetTemp !== null
                              ? `${point.targetTemp.toFixed(1)}°`
                              : "-"}
                          </td>
                        </>
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
