import { useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  ArrowLeft,
  Bluetooth,
  Check,
  X,
  SkipForward,
  RotateCcw,
  Printer,
  Zap,
} from "lucide-react";
import {
  isBluetoothSupported,
  connectPrinter,
  disconnectPrinter,
  DEFAULT_PRINT_SETTINGS,
  type PrinterConnection,
} from "@/lib/thermal-printer";

// ── Tiny BLE helpers (duplicated from thermal-printer to keep isolated) ──

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
    delay(7000).then(() => {
      throw new Error(`BLE timeout: ${ctx}`);
    }),
  ]);
}

// ── Step definitions ──

interface StepResult {
  status: "success" | "fail" | "skip";
  note?: string;
}

interface WizardStep {
  id: string;
  title: string;
  description: string;
  run: (conn: PrinterConnection, log: (msg: string) => void, chunkSize: number) => Promise<void>;
}

const CHUNK_OPTIONS = [20, 64, 128] as const;

const STEPS: WizardStep[] = [
  {
    id: "print-with-listener",
    title: "🎯 Ren print-sekvens (bekräftad fungerande)",
    description: "Start-job → gap → speed → density → raster (20B chunks) → end-job. Skriver 20 svarta rader.",
    run: async (conn, log) => {
      // Activate listener on 0xff03
      const service = await conn.device.gatt.getPrimaryService('0000ff00-0000-1000-8000-00805f9b34fb');
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
      log(`→ 6. Raster ${widthBytes*8}×${height}...`);
      await bleWrite(conn, new Uint8Array([
        0x1d, 0x76, 0x30, 0x00, widthBytes, 0x00, height, 0x00
      ]), "raster-hdr");
      await delay(100);

      const rasterData = new Uint8Array(widthBytes * height);
      rasterData.fill(0xff); // All black
      // Escape 0x0a → 0x14
      for (let i = 0; i < rasterData.length; i++) {
        if (rasterData[i] === 0x0a) rasterData[i] = 0x14;
      }
      for (let off = 0; off < rasterData.length; off += 20) {
        await bleWrite(conn, rasterData.slice(off, Math.min(off + 20, rasterData.length)), `r-${off}`);
      }
      await delay(500);
      log(`   Data skickad (${rasterData.length} bytes)`);

      log("→ 7. Väntar 3s på att skrivaren avslutar...");
      await delay(3000);

      await send([0x1f, 0x11, 0x03, 0x00], "8. End-job");
      await delay(500);

      try { await notifyChar.stopNotifications(); } catch { /* ok */ }
      log("✓ Klart! Skrivaren bör ha skrivit 20 svarta rader och stannat.");
    },
  },
];

// ── Component ──

export default function PrinterDebug() {
  const navigate = useNavigate();
  const [conn, setConn] = useState<PrinterConnection | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [results, setResults] = useState<Map<string, StepResult>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [chunkSize, setChunkSize] = useState<number>(128);
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

  const runStep = async () => {
    if (!conn) return;
    const step = STEPS[currentStep];
    setRunning(true);
    setError(null);
    addLog(`── Steg ${currentStep + 1}: ${step.title} ──`);
    try {
      await step.run(conn, addLog, chunkSize);
      addLog("✓ Steg skickat utan BLE-fel.");
    } catch (e: any) {
      setError(e.message);
      addLog(`✗ FEL: ${e.message}`);
    } finally {
      setRunning(false);
    }
  };

  const markResult = (status: "success" | "fail" | "skip") => {
    const step = STEPS[currentStep];
    setResults((prev) => new Map(prev).set(step.id, { status }));
    addLog(`→ Markerat som: ${status === "success" ? "FUNGERAR" : status === "fail" ? "INGEN REAKTION" : "HOPPADE ÖVER"}`);
    if (currentStep < STEPS.length - 1) {
      setCurrentStep((s) => s + 1);
    }
  };

  const resetWizard = () => {
    setCurrentStep(0);
    setResults(new Map());
    setLog([]);
    setError(null);
  };

  const step = STEPS[currentStep];
  const progress = ((currentStep) / STEPS.length) * 100;
  const hasBle = isBluetoothSupported();

  const successCount = Array.from(results.values()).filter((r) => r.status === "success").length;
  const failCount = Array.from(results.values()).filter((r) => r.status === "fail").length;

  return (
    <div className="min-h-screen bg-background text-foreground p-4 max-w-2xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/settings")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">
            <Printer className="h-5 w-5 text-primary" />
            Skrivar-debug wizard
          </h1>
          <p className="text-xs text-muted-foreground">
            Stega igenom BLE-kommandon steg-för-steg
          </p>
        </div>
      </div>

      {/* Connection */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bluetooth className="h-4 w-4" />
            <span className="text-sm font-medium">Anslutning</span>
          </div>
          {conn ? (
            <Badge className="bg-success text-success-foreground">
              {conn.device.name || "Ansluten"}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              Ej ansluten
            </Badge>
          )}
        </div>
        {!hasBle ? (
          <p className="text-xs text-destructive">Web Bluetooth stöds inte i denna webbläsare.</p>
        ) : conn ? (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleDisconnect}>
              Koppla från
            </Button>
            <p className="text-xs text-muted-foreground self-center">
              Write: {conn.writeMethod}
            </p>
          </div>
        ) : (
          <Button size="sm" onClick={handleConnect} disabled={isConnecting}>
            <Bluetooth className="h-3.5 w-3.5 mr-1.5" />
            {isConnecting ? "Ansluter..." : "Anslut skrivare"}
          </Button>
        )}
      </Card>

      {/* Chunk size selector */}
      {conn && (
        <Card className="p-3 flex items-center gap-3">
          <span className="text-xs font-medium text-muted-foreground">BLE chunk-storlek:</span>
          <div className="flex gap-1">
            {CHUNK_OPTIONS.map((size) => (
              <Button
                key={size}
                variant={chunkSize === size ? "default" : "outline"}
                size="sm"
                className="text-xs h-7 px-2.5"
                onClick={() => { setChunkSize(size); addLog(`Chunk-storlek ändrad till ${size} bytes`); }}
              >
                {size}B
              </Button>
            ))}
          </div>
          <span className="text-[10px] text-muted-foreground">
            (Geminis tips: prova 20 om 128 tappar paket)
          </span>
        </Card>
      )}

      {/* Progress overview */}
      {conn && (
        <>
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                Steg {currentStep + 1} av {STEPS.length}
              </span>
              <span>
                <span className="text-success">{successCount} OK</span>
                {failCount > 0 && <span className="text-destructive ml-2">{failCount} Nej</span>}
              </span>
            </div>
            <Progress value={progress} className="h-1.5" />
          </div>

          {/* Step list (compact) */}
          <div className="flex flex-wrap gap-1">
            {STEPS.map((s, i) => {
              const result = results.get(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() => !running && setCurrentStep(i)}
                  className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                    i === currentStep
                      ? "border-primary bg-primary/10 text-primary"
                      : result?.status === "success"
                        ? "border-success/30 text-success bg-success/5"
                        : result?.status === "fail"
                          ? "border-destructive/30 text-destructive bg-destructive/5"
                          : "border-border text-muted-foreground"
                  }`}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>

          {/* Current step */}
          <Card className="p-4 space-y-3">
            <div>
              <h2 className="text-sm font-bold flex items-center gap-2">
                <Zap className="h-3.5 w-3.5 text-primary" />
                {step.title}
              </h2>
              <p className="text-xs text-muted-foreground mt-1">{step.description}</p>
            </div>

            {error && (
              <p className="text-xs text-destructive bg-destructive/10 rounded p-2">{error}</p>
            )}

            <div className="flex gap-2 flex-wrap">
              <Button size="sm" onClick={runStep} disabled={running}>
                {running ? "Kör..." : "Kör steg"}
              </Button>

              <Button
                variant="outline"
                size="sm"
                className="border-success/40 text-success hover:bg-success/10"
                onClick={() => markResult("success")}
                disabled={running}
              >
                <Check className="h-3.5 w-3.5 mr-1" />
                Fungerar
              </Button>

              <Button
                variant="outline"
                size="sm"
                className="border-destructive/40 text-destructive hover:bg-destructive/10"
                onClick={() => markResult("fail")}
                disabled={running}
              >
                <X className="h-3.5 w-3.5 mr-1" />
                Ingen reaktion
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => markResult("skip")}
                disabled={running}
              >
                <SkipForward className="h-3.5 w-3.5 mr-1" />
                Hoppa
              </Button>
            </div>

            {results.get(step.id) && (
              <Badge
                variant="outline"
                className={
                  results.get(step.id)!.status === "success"
                    ? "border-success/40 text-success"
                    : results.get(step.id)!.status === "fail"
                      ? "border-destructive/40 text-destructive"
                      : "border-border text-muted-foreground"
                }
              >
                {results.get(step.id)!.status === "success"
                  ? "✓ Fungerade"
                  : results.get(step.id)!.status === "fail"
                    ? "✗ Ingen reaktion"
                    : "→ Hoppade över"}
              </Badge>
            )}
          </Card>

          {/* Summary when done */}
          {currentStep === STEPS.length - 1 && results.size > 0 && (
            <Card className="p-4 space-y-3">
              <h3 className="text-sm font-bold">Sammanfattning</h3>
              <div className="space-y-1">
                {STEPS.map((s) => {
                  const r = results.get(s.id);
                  return (
                    <div key={s.id} className="flex items-center gap-2 text-xs">
                      {r?.status === "success" ? (
                        <Check className="h-3 w-3 text-success" />
                      ) : r?.status === "fail" ? (
                        <X className="h-3 w-3 text-destructive" />
                      ) : (
                        <SkipForward className="h-3 w-3 text-muted-foreground" />
                      )}
                      <span className={!r ? "text-muted-foreground" : ""}>{s.title}</span>
                    </div>
                  );
                })}
              </div>
              <Button variant="outline" size="sm" onClick={resetWizard}>
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                Börja om
              </Button>
            </Card>
          )}

          {/* Log */}
          <Card className="p-3">
            <h3 className="text-xs font-semibold text-muted-foreground mb-2">Logg</h3>
            <div className="max-h-48 overflow-y-auto space-y-0.5 font-mono text-[11px] text-muted-foreground">
              {log.length === 0 ? (
                <p className="italic">Kör ett steg för att se loggen...</p>
              ) : (
                log.map((l, i) => (
                  <div
                    key={i}
                    className={
                      l.includes("FEL")
                        ? "text-destructive"
                        : l.includes("✓")
                          ? "text-success"
                          : ""
                    }
                  >
                    {l}
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
