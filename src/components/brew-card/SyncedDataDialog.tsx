import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { sv } from "date-fns/locale";

interface SgDataPoint {
  date: string;
  value: number;
  temp: number;
}

interface SyncedDataDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brewName: string;
  sgData: SgDataPoint[];
}

export function SyncedDataDialog({
  open,
  onOpenChange,
  brewName,
  sgData,
}: SyncedDataDialogProps) {
  // Sort by date descending (newest first)
  const sortedData = [...sgData].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Synkad data - {brewName}</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-muted-foreground mb-2">
          {sgData.length} mätpunkter
        </div>
        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-1">
            {sortedData.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                Ingen synkad data ännu
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b">
                    <th className="text-left py-2 font-medium">Datum</th>
                    <th className="text-right py-2 font-medium">SG</th>
                    <th className="text-right py-2 font-medium">Pill temp</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedData.map((point, index) => (
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
                        {point.value.toFixed(3)}
                      </td>
                      <td className="py-1.5 text-right font-mono text-temp-blue">
                        {point.temp.toFixed(1)}°C
                      </td>
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
