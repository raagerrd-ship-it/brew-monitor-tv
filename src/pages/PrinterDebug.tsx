import { useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Bluetooth,
  Printer,
  Zap,
} from "lucide-react";
import {
  isBluetoothSupported,
  connectPrinter,
  disconnectPrinter,
  printDebugTestPattern,
  DEFAULT_PRINT_SETTINGS,
  PRINTER_VERSION,
  type PrinterConnection,
} from "@/lib/thermal-printer";

const CHUNK_OPTIONS = [20, 50, 100, 200, 500];

export default function PrinterDebug() {
  const navigate = useNavigate();
  const [conn, setConn] = useState<PrinterConnection | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [chunkSize, setChunkSize] = useState(100);
  const logEndRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((msg: string) => {
    setLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  const handleConnect = async () => {
    setIsConnecting(true);
    setError(null);
    try {
      const c = await connectPrinter();
      setConn(c);
      addLog(`Ansluten till ${c.device.name || "okänd enhet"} (write: ${c.writeMethod})`);
    } catch (e: any) {
      if (!e?.message?.includes("cancelled") && e?.name !== "NotFoundError") {
        setError(e.message);
        addLog(`Anslutningsfel: ${e.message}`);
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = () => {
    if (conn) disconnectPrinter(conn);
    setConn(null);
    addLog("Frånkopplad.");
  };

  const handleRunTest = async () => {
    if (!conn) return;
    setRunning(true);
    setError(null);
    addLog(`── Kör debug-mönster (${PRINTER_VERSION}, chunk=${chunkSize}B) ──`);
    try {
      await printDebugTestPattern(
        conn,
        (p) => {
          addLog(`${p.phase} (${Math.round(p.percent)}%)`);
        },
        {
          ...DEFAULT_PRINT_SETTINGS,
          chunkSize,
          chunkDelay: 0,
          throttleEvery: 0,
          throttleDelay: 0,
        },
      );
      addLog("✓ Klart! Ram + kryss – kontrollera att alla 4 kanter syns.");
    } catch (e: any) {
      setError(e.message);
      addLog(`✗ FEL: ${e.message}`);
    } finally {
      setRunning(false);
    }
  };

  const hasBle = isBluetoothSupported();

  return (
    <div className="min-h-screen bg-background text-foreground p-4 max-w-2xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/settings")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">
            <Printer className="h-5 w-5 text-primary" />
            Skrivar-debug
          </h1>
          <p className="text-xs text-muted-foreground">{PRINTER_VERSION} — delad motor med justerbar chunk</p>
        </div>
      </div>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bluetooth className="h-4 w-4" />
            <span className="text-sm font-medium">Anslutning</span>
          </div>
          {conn ? (
            <Badge className="bg-success text-success-foreground">{conn.device.name || "Ansluten"}</Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">Ej ansluten</Badge>
          )}
        </div>

        {!hasBle ? (
          <p className="text-xs text-destructive">Web Bluetooth stöds inte i denna webbläsare.</p>
        ) : conn ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Chunk:</span>
              <div className="flex gap-1 flex-wrap">
                {CHUNK_OPTIONS.map((size) => (
                  <button
                    key={size}
                    onClick={() => setChunkSize(size)}
                    disabled={running}
                    className={`h-7 px-2 rounded text-xs font-mono transition-colors ${
                      chunkSize === size
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {size}B
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2 items-center">
              <Button size="sm" onClick={handleRunTest} disabled={running}>
                <Zap className="h-3.5 w-3.5 mr-1.5" />
                {running ? "Kör..." : `Kör print-test (${chunkSize}B)`}
              </Button>
              <Button variant="outline" size="sm" onClick={handleDisconnect}>Koppla från</Button>
            </div>
          </div>
        ) : (
          <Button size="sm" onClick={handleConnect} disabled={isConnecting}>
            <Bluetooth className="h-3.5 w-3.5 mr-1.5" />
            {isConnecting ? "Ansluter..." : "Anslut skrivare"}
          </Button>
        )}

        {error && <p className="text-xs text-destructive bg-destructive/10 rounded p-2">{error}</p>}
      </Card>

      {log.length > 0 && (
        <Card className="p-3">
          <h3 className="text-xs font-semibold text-muted-foreground mb-2">Logg</h3>
          <div className="max-h-48 overflow-y-auto space-y-0.5 font-mono text-[11px] text-muted-foreground">
            {log.map((l, i) => (
              <div key={i} className={l.includes("FEL") ? "text-destructive" : l.includes("✓") ? "text-success" : ""}>{l}</div>
            ))}
            <div ref={logEndRef} />
          </div>
        </Card>
      )}
    </div>
  );
}
