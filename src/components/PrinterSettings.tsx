import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bluetooth, BluetoothOff, Loader2, Printer } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  isBluetoothSupported,
  connectPrinter,
  reconnectLastPrinter,
  getLastDeviceName,
  setTargetPrinterName,
  disconnectPrinter,
  type PrinterConnection,
} from "@/lib/thermal-printer";

const TARGET_PRINTER_NAME = "Q199E44I1590809";

export function PrinterSettings() {
  const [bleConn, setBleConn] = useState<PrinterConnection | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const hasBle = isBluetoothSupported();

  // Seed target name
  useEffect(() => { setTargetPrinterName(TARGET_PRINTER_NAME); }, []);

  // Disconnect on unmount
  useEffect(() => {
    return () => { if (bleConn) disconnectPrinter(bleConn); };
  }, [bleConn]);

  const handleConnect = useCallback(async () => {
    setIsConnecting(true);
    try {
      // Try silent reconnect first
      let conn = await reconnectLastPrinter().catch(() => null);
      if (!conn) conn = await connectPrinter();
      setBleConn(conn);
      toast({ title: "Ansluten", description: `Ansluten till ${conn.device.name || 'skrivare'}` });
    } catch (e: any) {
      if (e?.message?.includes("cancelled") || e?.name === "NotFoundError") return;
      toast({ title: "Anslutningsfel", description: e.message, variant: "destructive" });
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const handleDisconnect = useCallback(() => {
    if (bleConn) {
      disconnectPrinter(bleConn);
      setBleConn(null);
      toast({ title: "Frånkopplad", description: "Skrivaren har kopplats från." });
    }
  }, [bleConn]);

  if (!hasBle) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <BluetoothOff className="h-4 w-4" />
        <span>Bluetooth stöds inte i denna webbläsare</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Connection status row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Printer className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">{TARGET_PRINTER_NAME}</p>
            <p className="text-[11px] text-muted-foreground">Phomemo M110 termoskrivare</p>
          </div>
        </div>
        {bleConn ? (
          <Badge variant="outline" className="text-[10px] border-success/40 text-success px-1.5 py-0">
            <Bluetooth className="h-2.5 w-2.5 mr-0.5" /> Ansluten
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] border-muted-foreground/40 text-muted-foreground px-1.5 py-0">
            <BluetoothOff className="h-2.5 w-2.5 mr-0.5" /> Ej ansluten
          </Badge>
        )}
      </div>

      {/* Action button */}
      {bleConn ? (
        <Button variant="outline" size="sm" className="w-full text-xs" onClick={handleDisconnect}>
          <BluetoothOff className="h-3.5 w-3.5 mr-1.5" />
          Koppla från
        </Button>
      ) : (
        <Button variant="outline" size="sm" className="w-full text-xs" onClick={handleConnect} disabled={isConnecting}>
          {isConnecting ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <Bluetooth className="h-3.5 w-3.5 mr-1.5" />
          )}
          {isConnecting ? "Ansluter..." : "Anslut skrivare"}
        </Button>
      )}
    </div>
  );
}
