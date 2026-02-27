import { useState, useEffect, useCallback, useRef } from "react";
import {
  isBluetoothSupported,
  connectPrinter,
  reconnectLastPrinter,
  getLastDeviceName,
  disconnectPrinter,
  printBitmap,
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
  const hasBle = isBluetoothSupported();
  const connRef = useRef<PrinterConnection | null>(null);

  // Keep ref in sync
  useEffect(() => { connRef.current = bleConn; }, [bleConn]);

  // Auto-reconnect when dialog opens
  useEffect(() => {
    if (!dialogOpen || bleConn || !hasBle) return;
    const lastDevice = getLastDeviceName();
    if (!lastDevice) return;

    let cancelled = false;
    setIsConnecting(true);

    reconnectLastPrinter()
      .then((conn) => {
        if (cancelled) { if (conn) disconnectPrinter(conn); return; }
        if (conn) {
          setBleConn(conn);
          toast({ title: "Återansluten", description: `Ansluten till ${conn.device.name || 'skrivare'}` });
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setIsConnecting(false); });

    return () => { cancelled = true; };
  }, [dialogOpen, hasBle]); // eslint-disable-line react-hooks/exhaustive-deps

  // Disconnect on unmount
  useEffect(() => {
    return () => { if (connRef.current) disconnectPrinter(connRef.current); };
  }, []);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    try {
      const conn = await connectPrinter();
      setBleConn(conn);
      toast({ title: "Ansluten", description: `Ansluten till ${conn.device.name || 'skrivare'}` });
    } catch (e: any) {
      if (e?.message?.includes('cancelled') || e?.name === 'NotFoundError') return;
      toast({ title: "Anslutningsfel", description: e.message, variant: "destructive" });
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    if (bleConn) {
      disconnectPrinter(bleConn);
      setBleConn(null);
      toast({ title: "Frånkopplad", description: "Skrivaren har kopplats från." });
    }
  }, [bleConn]);

  const print = useCallback(async (canvas: HTMLCanvasElement, copies: number) => {
    setIsPrinting(true);
    setPrintProgress({ phase: 'Startar...', percent: 0 });
    try {
      let conn = bleConn;
      if (!conn) {
        setPrintProgress({ phase: 'Ansluter till skrivare...', percent: 2 });
        conn = await reconnectLastPrinter().catch(() => null);
        if (!conn) conn = await connectPrinter();
        setBleConn(conn);
        toast({ title: "Ansluten", description: `Ansluten till ${conn.device.name || 'skrivare'}` });
      }
      await printBitmap(conn, canvas, copies, DEFAULT_PRINT_SETTINGS, setPrintProgress);
      toast({ title: "Utskrivet!", description: `${copies} etikett${copies > 1 ? 'er' : ''} skickade till skrivaren.` });
    } catch (e: any) {
      if (e?.message?.includes('cancelled') || e?.name === 'NotFoundError') {
        setIsPrinting(false);
        setPrintProgress(null);
        return;
      }
      toast({ title: "Utskriftsfel", description: e.message, variant: "destructive" });
      setBleConn(null);
    } finally {
      setIsPrinting(false);
      setTimeout(() => setPrintProgress(null), 2000);
    }
  }, [bleConn]);

  return { hasBle, bleConn, isConnecting, isPrinting, printProgress, connect, disconnect, print };
}
