import { useState, useEffect, useCallback, useRef } from "react";
import {
  isBluetoothSupported,
  reconnectLastPrinter,
  getLastDeviceName,
  disconnectPrinter,
  printBitmapBypassProcessing,
  DEFAULT_PRINT_SETTINGS,
  type PrinterConnection,
  type PrintProgress,
} from "@/lib/thermal-printer";
import { toast } from "@/hooks/use-toast";

export function usePrinterConnection(dialogOpen: boolean) {
  const [bleConn, setBleConn] = useState<PrinterConnection | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const [printProgress, setPrintProgress] = useState<PrintProgress | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [autoConnectFailed, setAutoConnectFailed] = useState(false);
  const hasBle = isBluetoothSupported();
  const connRef = useRef<PrinterConnection | null>(null);
  const targetName = getLastDeviceName();

  // Keep ref in sync
  useEffect(() => { connRef.current = bleConn; }, [bleConn]);

  // Auto-reconnect to saved printer when dialog opens
  useEffect(() => {
    if (!dialogOpen || bleConn || !hasBle || !targetName) return;

    let cancelled = false;
    setIsConnecting(true);
    setAutoConnectFailed(false);

    reconnectLastPrinter()
      .then((conn) => {
        if (cancelled) { if (conn) disconnectPrinter(conn); return; }
        if (conn) {
          setBleConn(conn);
          toast({ title: "Återansluten", description: `Ansluten till ${conn.device.name || 'skrivare'}` });
        } else {
          if (!cancelled) setAutoConnectFailed(true);
        }
      })
      .catch(() => { if (!cancelled) setAutoConnectFailed(true); })
      .finally(() => { if (!cancelled) setIsConnecting(false); });

    return () => { cancelled = true; };
  }, [dialogOpen, hasBle]); // eslint-disable-line react-hooks/exhaustive-deps

  // Disconnect on unmount
  useEffect(() => {
    return () => { if (connRef.current) disconnectPrinter(connRef.current); };
  }, []);

  const retry = useCallback(async () => {
    setIsConnecting(true);
    setAutoConnectFailed(false);
    try {
      const conn = await reconnectLastPrinter();
      if (conn) {
        setBleConn(conn);
        toast({ title: "Återansluten", description: `Ansluten till ${conn.device.name || 'skrivare'}` });
      } else {
        setAutoConnectFailed(true);
        toast({ title: "Kunde inte ansluta", description: "Kontrollera att skrivaren är på och nära.", variant: "destructive" });
      }
    } catch {
      setAutoConnectFailed(true);
      toast({ title: "Kunde inte ansluta", description: "Kontrollera att skrivaren är på och nära.", variant: "destructive" });
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const print = useCallback(async (canvas: HTMLCanvasElement, copies: number) => {
    setIsPrinting(true);
    setPrintProgress({ phase: 'Startar...', percent: 0 });
    try {
      let conn = bleConn;
      if (!conn) {
        setPrintProgress({ phase: `Återansluter till ${targetName || 'skrivare'}...`, percent: 2 });
        conn = await reconnectLastPrinter().catch(() => null);
        if (!conn) {
          throw new Error("Kunde inte ansluta till skrivaren. Gå till Inställningar → Enheter för att ansluta.");
        }
        setBleConn(conn);
        setAutoConnectFailed(false);
        toast({ title: "Återansluten", description: `Ansluten till ${conn.device.name || 'skrivare'}` });
      }
      await printBitmapBypassProcessing(conn, canvas, copies, DEFAULT_PRINT_SETTINGS, setPrintProgress);
      toast({ title: "Utskrivet!", description: `${copies} etikett${copies > 1 ? 'er' : ''} skickade till skrivaren.` });
    } catch (e: any) {
      if (e?.message?.includes('cancelled') || e?.name === 'NotFoundError') {
        setIsPrinting(false);
        setPrintProgress(null);
        return;
      }
      toast({ title: "Utskriftsfel", description: e.message, variant: "destructive" });
      setBleConn(null);
      setAutoConnectFailed(true);
    } finally {
      setIsPrinting(false);
      setTimeout(() => setPrintProgress(null), 2000);
    }
  }, [bleConn, targetName]);

  return {
    hasBle, bleConn, isConnecting, isPrinting, printProgress,
    autoConnectFailed, targetPrinterName: targetName,
    retry, print,
  };
}
