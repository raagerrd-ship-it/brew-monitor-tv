import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bluetooth, BluetoothOff, Loader2, Printer, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  isBluetoothSupported,
  connectPrinter,
  reconnectLastPrinter,
  getLastDeviceName,
  clearLastDevice,
  disconnectPrinter,
  type PrinterConnection,
} from "@/lib/thermal-printer";

export function PrinterSettings() {
  const [bleConn, setBleConn] = useState<PrinterConnection | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [savedName, setSavedName] = useState<string | null>(getLastDeviceName());
  const hasBle = isBluetoothSupported();

  // Disconnect on unmount
  useEffect(() => {
    return () => { if (bleConn) disconnectPrinter(bleConn); };
  }, [bleConn]);

  const handleConnect = useCallback(async () => {
    setIsConnecting(true);
    try {
      // Try silent reconnect to saved device first, then BLE picker
      let conn = savedName ? await reconnectLastPrinter().catch(() => null) : null;
      if (!conn) conn = await connectPrinter();
      setBleConn(conn);
      setSavedName(conn.device.name || null);
      toast({ title: "Ansluten", description: `Ansluten till ${conn.device.name || 'skrivare'}` });
    } catch (e: any) {
      if (e?.message?.includes("cancelled") || e?.name === "NotFoundError") return;
      toast({ title: "Anslutningsfel", description: e.message, variant: "destructive" });
    } finally {
      setIsConnecting(false);
    }
  }, [savedName]);

  const handleDisconnect = useCallback(() => {
    if (bleConn) {
      disconnectPrinter(bleConn);
      setBleConn(null);
      toast({ title: "Frånkopplad", description: "Skrivaren har kopplats från." });
    }
  }, [bleConn]);

  const handleForget = useCallback(() => {
    if (bleConn) disconnectPrinter(bleConn);
    setBleConn(null);
    clearLastDevice();
    setSavedName(null);
    toast({ title: "Skrivare borttagen", description: "Ingen skrivare är längre sparad." });
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
      {/* Saved printer info */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Printer className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">{savedName || 'Ingen skrivare vald'}</p>
            {savedName && <p className="text-[11px] text-muted-foreground">Bluetooth-termoskrivare</p>}
          </div>
        </div>
        {bleConn ? (
          <Badge variant="outline" className="text-[10px] border-success/40 text-success px-1.5 py-0">
            <Bluetooth className="h-2.5 w-2.5 mr-0.5" /> Ansluten
          </Badge>
        ) : savedName ? (
          <Badge variant="outline" className="text-[10px] border-muted-foreground/40 text-muted-foreground px-1.5 py-0">
            <BluetoothOff className="h-2.5 w-2.5 mr-0.5" /> Ej ansluten
          </Badge>
        ) : null}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        {bleConn ? (
          <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={handleDisconnect}>
            <BluetoothOff className="h-3.5 w-3.5 mr-1.5" />
            Koppla från
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={handleConnect} disabled={isConnecting}>
            {isConnecting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Bluetooth className="h-3.5 w-3.5 mr-1.5" />}
            {isConnecting ? "Ansluter..." : savedName ? "Återanslut" : "Koppla skrivare"}
          </Button>
        )}
        {savedName && !bleConn && (
          <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={handleForget}>
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
