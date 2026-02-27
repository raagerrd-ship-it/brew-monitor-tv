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
  type PrinterConnection,
} from "@/lib/thermal-printer";

function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function bleWrite(conn: PrinterConnection, data: Uint8Array, ctx: string) {
  const buffer = new Uint8Array(data).buffer;
  const p =
    conn.writeMethod === "withoutResponse"
      ? conn.characteristic.writeValueWithoutResponse(buffer)
      : conn.characteristic.writeValue(buffer);
  await Promise.race([
    p,
    delay(7000).then(() => { throw new Error(`BLE timeout: ${ctx}`); }),
  ]);
}

async function runPrintTest(conn: PrinterConnection, log: (msg: string) => void) {
  const service = await conn.device.gatt!.getPrimaryService('0000ff00-0000-1000-8000-00805f9b34fb');
  const notifyChar = await service.getCharacteristic('0000ff03-0000-1000-8000-00805f9b34fb');
  notifyChar.addEventListener('characteristicvaluechanged', (event: any) => {
    const value = new Uint8Array(event.target.value.buffer);
    const hex = Array.from(value).map((b: number) => '0x' + b.toString(16).padStart(2, '0')).join(' ');
    log(`   📨 [${hex}]`);
  });
  await notifyChar.startNotifications();
  log("✓ Lyssnare aktiv");
  await delay(200);

  const send = async (data: number[], label: string) => {
    log(`→ ${label}`);
    await bleWrite(conn, new Uint8Array(data), label);
    await delay(300);
  };

  await send([0x1b, 0x40], "1. ESC @ (init)");
  await send([0x1f, 0x11, 0x02, 0x00], "2. Start-job");
  await send([0x1f, 0x11, 0x0e, 0x01], "3. GAP-mode");
  await send([0x1b, 0x4e, 0x0d, 0x03], "4. Speed=3");
  await send([0x1b, 0x4e, 0x04, 0x08], "5. Density=8");

  const widthBytes = 48;
  const height = 20;
  log(`→ 6. Raster ${widthBytes * 8}×${height}...`);
  await bleWrite(conn, new Uint8Array([
    0x1d, 0x76, 0x30, 0x00, widthBytes, 0x00, height, 0x00
  ]), "raster-hdr");
  await delay(100);

  const rasterData = new Uint8Array(widthBytes * height);
  rasterData.fill(0xff);
  for (let i = 0; i < rasterData.length; i++) {
    if (rasterData[i] === 0x0a) rasterData[i] = 0x14;
  }
  for (let off = 0; off < rasterData.length; off += 20) {
    await bleWrite(conn, rasterData.slice(off, Math.min(off + 20, rasterData.length)), `r-${off}`);
  }
  await delay(500);
  log(`   Data skickad (${rasterData.length} bytes)`);

  log("→ 7. Väntar 3s...");
  await delay(3000);

  await send([0x1f, 0x11, 0x03, 0x00], "8. End-job");
  await delay(500);

  try { await notifyChar.stopNotifications(); } catch { /* ok */ }
  log("✓ Klart! Skrivaren bör ha skrivit 20 svarta rader och stannat.");
}

export default function PrinterDebug() {
  const navigate = useNavigate();
  const [conn, setConn] = useState<PrinterConnection | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
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
    addLog("── Kör print-test ──");
    try {
      await runPrintTest(conn, addLog);
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
          <p className="text-xs text-muted-foreground">Skriver 20 svarta rader som test</p>
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
          <div className="flex gap-2 items-center">
            <Button size="sm" onClick={handleRunTest} disabled={running}>
              <Zap className="h-3.5 w-3.5 mr-1.5" />
              {running ? "Kör..." : "Kör print-test"}
            </Button>
            <Button variant="outline" size="sm" onClick={handleDisconnect}>Koppla från</Button>
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
