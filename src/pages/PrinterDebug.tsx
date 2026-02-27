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
    id: "esc-init",
    title: "ESC @ (Initialize)",
    description: "Skickar initialize-kommandot. Skrivaren bör inte göra något synligt, men bör acceptera datan utan fel.",
    run: async (conn, log) => {
      log("Skickar ESC @ (0x1b 0x40)...");
      await bleWrite(conn, new Uint8Array([0x1b, 0x40]), "init");
      await delay(100);
      log("Klart. Ingen synlig reaktion förväntas.");
    },
  },
  {
    id: "esc-center",
    title: "ESC a 1 (Center justify)",
    description: "Skickar center-justering. Ingen synlig effekt förväntas.",
    run: async (conn, log) => {
      log("Skickar ESC a 1 (0x1b 0x61 0x01)...");
      await bleWrite(conn, new Uint8Array([0x1b, 0x61, 0x01]), "center");
      await delay(100);
      log("Klart.");
    },
  },
  {
    id: "config-cmd",
    title: "Config-sekvens (0x1f 0x11 0x02 0x04)",
    description: "Okänt konfigurationskommando som alltid skickas av phomemo-tools.",
    run: async (conn, log) => {
      log("Skickar 0x1f 0x11 0x02 0x04...");
      await bleWrite(conn, new Uint8Array([0x1f, 0x11, 0x02, 0x04]), "config");
      await delay(100);
      log("Klart.");
    },
  },
  {
    id: "white-1line",
    title: "Raster: 1 vit rad (384px)",
    description: "Skickar GS v 0 header + 48 noll-bytes (en helt vit rad). Skrivaren kanske matar fram lite papper.",
    run: async (conn, log) => {
      const widthBytes = 48; // 384/8
      const height = 1;
      log("Skickar raster-header (1 rad)...");
      await bleWrite(
        conn,
        new Uint8Array([0x1d, 0x76, 0x30, 0x00, widthBytes, 0x00, height & 0xff, 0x00]),
        "raster-hdr"
      );
      log("Skickar 48 noll-bytes (vit rad)...");
      await bleWrite(conn, new Uint8Array(widthBytes), "white-1");
      await delay(200);
      log("Klart.");
    },
  },
  {
    id: "white-10lines",
    title: "Raster: 10 vita rader",
    description: "Skickar 10 helt vita rader. Skrivaren bör mata fram lite papper.",
    run: async (conn, log) => {
      const widthBytes = 48;
      const height = 10;
      log("Skickar raster-header (10 rader)...");
      await bleWrite(
        conn,
        new Uint8Array([0x1d, 0x76, 0x30, 0x00, widthBytes, 0x00, height & 0xff, 0x00]),
        "raster-hdr"
      );
      log("Skickar 480 noll-bytes...");
      await bleWrite(conn, new Uint8Array(widthBytes * height), "white-10");
      await delay(300);
      log("Klart.");
    },
  },
  {
    id: "black-line",
    title: "Raster: 1 svart rad",
    description: "Skickar en hel rad med svarta pixlar (alla bitar = 1). Du bör se ett svart streck.",
    run: async (conn, log) => {
      const widthBytes = 48;
      log("Skickar raster-header (1 rad)...");
      await bleWrite(
        conn,
        new Uint8Array([0x1d, 0x76, 0x30, 0x00, widthBytes, 0x00, 0x01, 0x00]),
        "raster-hdr"
      );
      const blackRow = new Uint8Array(widthBytes).fill(0xff);
      log("Skickar 48 0xFF-bytes (svart)...");
      await bleWrite(conn, blackRow, "black-1");
      await delay(300);
      log("Klart.");
    },
  },
  {
    id: "stripe-pattern",
    title: "Raster: 20 rader randig (svart+vit)",
    description: "Skickar 20 rader som alternerar svart/vit. Du bör se horisontella ränder.",
    run: async (conn, log, chunkSize) => {
      const widthBytes = 48;
      const height = 20;
      log("Skickar raster-header (20 rader)...");
      await bleWrite(
        conn,
        new Uint8Array([0x1d, 0x76, 0x30, 0x00, widthBytes, 0x00, height & 0xff, 0x00]),
        "raster-hdr"
      );
      const data = new Uint8Array(widthBytes * height);
      for (let y = 0; y < height; y++) {
        if (y % 2 === 0) {
          for (let x = 0; x < widthBytes; x++) data[y * widthBytes + x] = 0xff;
        }
      }
      log(`Skickar ${data.length} bytes randigt mönster (chunk=${chunkSize})...`);
      for (let off = 0; off < data.length; off += chunkSize) {
        await bleWrite(conn, data.slice(off, Math.min(off + chunkSize, data.length)), `stripe@${off}`);
        await delay(20);
      }
      await delay(300);
      log("Klart.");
    },
  },
  {
    id: "footer",
    title: "Footer (CUPS)",
    description: "Skickar CUPS-footer-sekvensen som signalerar slutet av utskriften.",
    run: async (conn, log) => {
      log("Skickar footer (0x1f 0xf0 0x05 0x00, 0x1f 0xf0 0x03 0x00)...");
      await bleWrite(
        conn,
        new Uint8Array([0x1f, 0xf0, 0x05, 0x00, 0x1f, 0xf0, 0x03, 0x00]),
        "footer"
      );
      await delay(500);
      log("Klart.");
    },
  },
  {
    id: "full-white-image",
    title: "Full vit bild med svart streck (384×100)",
    description: "Skickar init → raster → data → footer. Första raden är svart så du kan se att den skriver. Resten är vitt.",
    run: async (conn, log, chunkSize) => {
      const widthBytes = 48;
      const height = 100;

      log("Init (ESC @)...");
      await bleWrite(conn, new Uint8Array([0x1b, 0x40]), "init");
      await delay(30);

      log("Raster header...");
      await bleWrite(
        conn,
        new Uint8Array([0x1d, 0x76, 0x30, 0x00, widthBytes, 0x00, height & 0xff, 0x00]),
        "raster-hdr"
      );

      const data = new Uint8Array(widthBytes * height);
      // Första raden svart så vi ser att den skriver
      data.fill(0xff, 0, widthBytes);
      // Sista raden också svart
      data.fill(0xff, (height - 1) * widthBytes, height * widthBytes);

      log(`Skickar ${data.length} bytes (chunk=${chunkSize})...`);
      for (let off = 0; off < data.length; off += chunkSize) {
        await bleWrite(conn, data.slice(off, Math.min(off + chunkSize, data.length)), `wh@${off}`);
        await delay(20);
      }

      await delay(300);
      log("Footer...");
      await bleWrite(
        conn,
        new Uint8Array([0x1f, 0xf0, 0x05, 0x00, 0x1f, 0xf0, 0x03, 0x00]),
        "footer"
      );
      await delay(500);
      log("Klart! Du bör se två svarta streck med vitt emellan.");
    },
  },
  {
    id: "gemini-protocol",
    title: "Gemini v1 (100px höjd)",
    description: "Start-job → raster 384×100 → 10 svarta + 90 vita → print-execute → end-job.",
    run: async (conn, log, chunkSize) => {
      log("1. Start-job (0x1f 0x11 0x02 0x00)...");
      await bleWrite(conn, new Uint8Array([0x1f, 0x11, 0x02, 0x00]), "start-job");
      await delay(50);

      const widthBytes = 48;
      const height = 100;

      log("2. Raster header (GS v 0, 384×100)...");
      await bleWrite(conn, new Uint8Array([
        0x1d, 0x76, 0x30, 0x00,
        0x30, 0x00,
        0x64, 0x00,
      ]), "raster-hdr");

      log("3. Genererar data (10 svarta + 90 vita rader)...");
      const data = new Uint8Array(widthBytes * height);
      data.fill(0xff, 0, widthBytes * 10);

      log(`   Skickar ${data.length} bytes (chunk=${chunkSize})...`);
      for (let off = 0; off < data.length; off += chunkSize) {
        await bleWrite(conn, data.slice(off, Math.min(off + chunkSize, data.length)), `data-${off}`);
      }

      log("4. Print-execute (0x1f 0x11 0x04 0x00)...");
      await bleWrite(conn, new Uint8Array([0x1f, 0x11, 0x04, 0x00]), "print-execute");
      await delay(100);

      log("5. End-job (0x1f 0x11 0x03 0x00)...");
      await bleWrite(conn, new Uint8Array([0x1f, 0x11, 0x03, 0x00]), "end-job");
      await delay(200);

      log("Klart! Du bör se en svart rektangel (10 rader) följt av vitt.");
    },
  },
  {
    id: "gemini-label-50x70",
    title: "Gemini v2 – 50×70mm etikett (gap-läge)",
    description: "Sätter GAP-mode → start-job → raster 384×560 (50×70mm) → 20 svarta rader + resten vitt → print-execute → end-job. Anpassad för ditt etikettformat.",
    run: async (conn, log, chunkSize) => {
      log("1. Set GAP mode (0x1f 0x11 0x0e 0x01)...");
      await bleWrite(conn, new Uint8Array([0x1f, 0x11, 0x0e, 0x01]), "set-gap-mode");
      await delay(50);

      log("2. Start-job (0x1f 0x11 0x02 0x00)...");
      await bleWrite(conn, new Uint8Array([0x1f, 0x11, 0x02, 0x00]), "start-job");
      await delay(50);

      const widthBytes = 48;
      const height = 560; // 70mm × 8 dots/mm = 560

      log("3. Raster header (384×560)...");
      await bleWrite(conn, new Uint8Array([
        0x1d, 0x76, 0x30, 0x00,
        0x30, 0x00,       // xL=48, xH=0
        0x30, 0x02,       // yL=0x30, yH=0x02 → 560
      ]), "raster-hdr");

      log("4. Genererar data (20 svarta + 540 vita rader)...");
      const data = new Uint8Array(widthBytes * height);
      data.fill(0xff, 0, widthBytes * 20);

      log(`   Skickar ${data.length} bytes (chunk=${chunkSize})...`);
      let sent = 0;
      for (let off = 0; off < data.length; off += chunkSize) {
        await bleWrite(conn, data.slice(off, Math.min(off + chunkSize, data.length)), `d-${off}`);
        sent++;
        if (sent % 100 === 0) log(`   ...${Math.round((off / data.length) * 100)}%`);
      }

      log("5. Print-execute (0x1f 0x11 0x04 0x00)...");
      await bleWrite(conn, new Uint8Array([0x1f, 0x11, 0x04, 0x00]), "print-execute");
      await delay(100);

      log("6. End-job (0x1f 0x11 0x03 0x00)...");
      await bleWrite(conn, new Uint8Array([0x1f, 0x11, 0x03, 0x00]), "end-job");
      await delay(200);

      log("Klart! Bör skriva ut en 50×70mm etikett med svart streck och stanna vid gap-sensorn.");
    },
  },
  {
    id: "gemini-feed-to-gap",
    title: "Mata till gap (start → gap-mode → feed → end)",
    description: "Enklast möjliga test: väcker skrivaren, sätter gap-mode, kör feed-to-gap (0x04) och avslutar. Ska mata pappret till nästa glipa.",
    run: async (conn, log) => {
      log("1. Start (0x1f 0x11 0x02 0x00)...");
      await bleWrite(conn, new Uint8Array([0x1f, 0x11, 0x02, 0x00]), "start");
      await delay(50);

      log("2. Set GAP mode (0x1f 0x11 0x0e 0x01)...");
      await bleWrite(conn, new Uint8Array([0x1f, 0x11, 0x0e, 0x01]), "set-gap-mode");
      await delay(50);

      log("3. Feed-to-gap (0x1f 0x11 0x04 0x00)...");
      await bleWrite(conn, new Uint8Array([0x1f, 0x11, 0x04, 0x00]), "feed-to-gap");
      await delay(200);

      log("4. End (0x1f 0x11 0x03 0x00)...");
      await bleWrite(conn, new Uint8Array([0x1f, 0x11, 0x03, 0x00]), "end");
      await delay(100);

      log("Klart! Pappret bör ha matats fram till nästa glipa.");
    },
  },
  {
    id: "wakeup-status-feed",
    title: "Wake + Status + ESC/POS Feed",
    description: "Skickar 4 nollor (wakeup) → status-check (0x08) → ESC d 2 (feed). Testar om skrivaren reagerar på klassiska ESC/POS-kommandon.",
    run: async (conn, log) => {
      log("1. Wakeup (4× 0x00)...");
      await bleWrite(conn, new Uint8Array([0x00, 0x00, 0x00, 0x00]), "wakeup");
      await delay(100);

      log("2. Status check (0x1f 0x11 0x08 0x00)...");
      await bleWrite(conn, new Uint8Array([0x1f, 0x11, 0x08, 0x00]), "get-status");
      await delay(100);

      log("3. ESC d 2 – feed 2 rader...");
      await bleWrite(conn, new Uint8Array([0x1b, 0x64, 0x02]), "esc-pos-feed");
      await delay(200);

      log("Klart! Om skrivaren är vaken bör pappret ha matats lite.");
    },
  },
  {
    id: "force-with-response",
    title: "Tvinga writeValue (withResponse) + feed",
    description: "Skickar samma kommandon men med writeValue istället för writeValueWithoutResponse. Ger faktisk bekräftelse från skrivaren – om det misslyckas vet vi att skrivaren avvisar datan.",
    run: async (conn, log) => {
      const char = conn.characteristic;
      const write = async (data: Uint8Array, label: string) => {
        log(`   ${label}: [${Array.from(data).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ')}]`);
        try {
          await char.writeValue(new Uint8Array(data).buffer);
          log(`   ✓ ${label} – writeValue OK (skrivaren accepterade)`);
        } catch (e: any) {
          log(`   ✗ ${label} – writeValue MISSLYCKADES: ${e.message}`);
          log(`   Provar writeValueWithoutResponse...`);
          try {
            await char.writeValueWithoutResponse(new Uint8Array(data).buffer);
            log(`   ~ ${label} – writeValueWithoutResponse OK (ingen bekräftelse)`);
          } catch (e2: any) {
            log(`   ✗✗ ${label} – BÅDA misslyckades: ${e2.message}`);
          }
        }
      };

      log("1. ESC @ (initialize)...");
      await write(new Uint8Array([0x1b, 0x40]), "ESC @");
      await delay(100);

      log("2. Start-job (0x1f 0x11 0x02 0x00)...");
      await write(new Uint8Array([0x1f, 0x11, 0x02, 0x00]), "start-job");
      await delay(100);

      log("3. Feed-to-gap (0x1f 0x11 0x04 0x00)...");
      await write(new Uint8Array([0x1f, 0x11, 0x04, 0x00]), "feed-to-gap");
      await delay(300);

      log("4. ESC d 5 (feed 5 rader)...");
      await write(new Uint8Array([0x1b, 0x64, 0x05]), "ESC d 5");
      await delay(300);

      log("5. End-job (0x1f 0x11 0x03 0x00)...");
      await write(new Uint8Array([0x1f, 0x11, 0x03, 0x00]), "end-job");
      await delay(100);

      log("Klart! Kolla loggarna ovan – om writeValue lyckades tar skrivaren emot datan.");
    },
  },
  {
    id: "ble-notify-listener",
    title: "🔔 Lista alla karakteristiker + lyssna på svar",
    description: "Listar ALLA karakteristiker i 0xff00-servicen med deras egenskaper, försöker aktivera notifications/indications, och skickar status-kommandon.",
    run: async (conn, log) => {
      const service = await conn.device.gatt.getPrimaryService('0000ff00-0000-1000-8000-00805f9b34fb');

      log("1. Listar alla karakteristiker i 0xff00...");
      let chars: any[] = [];
      try {
        chars = await service.getCharacteristics();
        for (const c of chars) {
          const props = c.properties;
          const flags = [
            props.read && 'READ',
            props.write && 'WRITE',
            props.writeWithoutResponse && 'WRITE_NO_RESP',
            props.notify && 'NOTIFY',
            props.indicate && 'INDICATE',
          ].filter(Boolean).join(', ');
          log(`   ${c.uuid} → [${flags}]`);
        }
      } catch (e: any) {
        log(`   ✗ Kunde inte lista: ${e.message}`);
        return;
      }

      // Try to find a readable/notify/indicate characteristic
      log("");
      log("2. Försöker aktivera lyssnare...");
      for (const c of chars) {
        if (c.properties.notify || c.properties.indicate) {
          log(`   Provar ${c.uuid} (${c.properties.notify ? 'notify' : 'indicate'})...`);
          c.addEventListener('characteristicvaluechanged', (event: any) => {
            const value = new Uint8Array(event.target.value.buffer);
            const hex = Array.from(value).map((b: number) => '0x' + b.toString(16).padStart(2, '0')).join(' ');
            log(`   📨 SVAR från ${c.uuid}: [${hex}] (${value.length} bytes)`);
          });
          try {
            await c.startNotifications();
            log(`   ✓ Notifications aktiva på ${c.uuid}`);
          } catch (e: any) {
            log(`   ✗ startNotifications misslyckades: ${e.message}`);
            // If indicate, try reading instead
            if (c.properties.read) {
              try {
                const val = await c.readValue();
                const bytes = new Uint8Array(val.buffer);
                const hex = Array.from(bytes).map((b: number) => '0x' + b.toString(16).padStart(2, '0')).join(' ');
                log(`   📖 readValue: [${hex}] (${bytes.length} bytes)`);
              } catch (e2: any) {
                log(`   ✗ readValue misslyckades: ${e2.message}`);
              }
            }
          }
        }
        if (c.properties.read && !c.properties.notify && !c.properties.indicate) {
          log(`   Läser ${c.uuid}...`);
          try {
            const val = await c.readValue();
            const bytes = new Uint8Array(val.buffer);
            const hex = Array.from(bytes).map((b: number) => '0x' + b.toString(16).padStart(2, '0')).join(' ');
            log(`   📖 ${c.uuid}: [${hex}] (${bytes.length} bytes)`);
          } catch (e: any) {
            log(`   ✗ readValue: ${e.message}`);
          }
        }
      }

      log("");
      log("3. Skickar status-kommandon...");
      const cmds = [
        { data: [0x1f, 0x11, 0x08, 0x00], label: "0x08" },
        { data: [0x1f, 0x11, 0x07, 0x00], label: "0x07" },
        { data: [0x1f, 0x11, 0x09, 0x00], label: "0x09" },
      ];
      for (const cmd of cmds) {
        log(`   → Status ${cmd.label}...`);
        await bleWrite(conn, new Uint8Array(cmd.data), cmd.label);
        await delay(500);
      }

      log("   Väntar 2s på svar...");
      await delay(2000);
      log("Klart! Kolla ovan för SVAR-rader eller läsvärden.");
    },
  },
  {
    id: "cpcl-test",
    title: "🔤 CPCL-kommandotest (Q-serien)",
    description: "Testar CPCL-kommandon som ofta används av Q-serie/nyare Phomemo-skrivare istället för ESC/POS. Skickar en minimal CPCL-etikett.",
    run: async (conn, log) => {
      const encoder = new TextEncoder();

      // CPCL is text-based, each line terminated by \r\n
      const cpcl = [
        "! 0 200 200 100 1",       // Start: offset=0, 200dpi horiz, 200dpi vert, 100 dots height, 1 copy
        "LABEL",                    // Label mode
        "CONTRAST 0",              // Default contrast
        "TONE 0",                  // Default tone
        "SPEED 5",                 // Speed
        "BAR-SENSE",               // Use gap sensor
        "T 4 0 10 10 TEST",       // Text: font4, size0, x=10, y=10, "TEST"
        "PRINT",                   // Execute print
      ];

      log("Skickar CPCL-kommandon:");
      for (const line of cpcl) {
        log(`  → ${line}`);
        const data = encoder.encode(line + "\r\n");
        await bleWrite(conn, data, `cpcl-${line.substring(0, 10)}`);
        await delay(50);
      }

      log("");
      log("Alternativ 2: TSPL-kommandon...");
      const tspl = [
        "SIZE 50 mm, 70 mm",
        "GAP 2 mm, 0 mm",
        "CLS",
        "TEXT 50,50,\"3\",0,1,1,\"TEST\"",
        "PRINT 1,1",
      ];
      for (const line of tspl) {
        log(`  → ${line}`);
        const data = encoder.encode(line + "\r\n");
        await bleWrite(conn, data, `tspl-${line.substring(0, 10)}`);
        await delay(50);
      }

      log("");
      log("Klart! Om skrivaren stödjer CPCL eller TSPL bör den ha reagerat.");
    },
  },
  {
    id: "print-with-listener",
    title: "🎯 Print med svarslyssnare (mini-raster)",
    description: "Aktiverar notify på 0xff03, skickar sedan hela print-sekvensen steg för steg och visar skrivarens svar/felkoder efter varje kommando.",
    run: async (conn, log) => {
      // 1. Activate listener on 0xff03
      const service = await conn.device.gatt.getPrimaryService('0000ff00-0000-1000-8000-00805f9b34fb');
      const notifyChar = await service.getCharacteristic('0000ff03-0000-1000-8000-00805f9b34fb');
      const responses: string[] = [];
      notifyChar.addEventListener('characteristicvaluechanged', (event: any) => {
        const value = new Uint8Array(event.target.value.buffer);
        const hex = Array.from(value).map((b: number) => '0x' + b.toString(16).padStart(2, '0')).join(' ');
        const ascii = Array.from(value).map((b: number) => b >= 32 && b < 127 ? String.fromCharCode(b) : '.').join('');
        const msg = `📨 [${hex}] "${ascii}"`;
        responses.push(msg);
        log(`   ${msg}`);
      });
      await notifyChar.startNotifications();
      log("✓ Lyssnare aktiv på 0xff03");
      await delay(200);

      const send = async (data: number[], label: string) => {
        log(`→ ${label}: [${data.map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ')}]`);
        await bleWrite(conn, new Uint8Array(data), label);
        await delay(400); // Wait for response
      };

      // 2. Try ESC @ (initialize)
      log("");
      log("── A. ESC/POS-sekvens ──");
      await send([0x1b, 0x40], "ESC @ (init)");

      // 3. Start-job
      await send([0x1f, 0x11, 0x02, 0x00], "start-job");

      // 4. Set gap mode
      await send([0x1f, 0x11, 0x0e, 0x01], "set-gap");

      // 5. Speed + density
      await send([0x1b, 0x4e, 0x0d, 0x03], "speed=3");
      await send([0x1b, 0x4e, 0x04, 0x08], "density=8");

      // 6. Small raster: 384px wide × 10 rows = 480 bytes
      const widthBytes = 48;
      const height = 10;
      log(`→ GS v 0 raster (${widthBytes*8}×${height})...`);
      await send([0x1d, 0x76, 0x30, 0x00, widthBytes, 0x00, height, 0x00], "raster-hdr");

      // 10 rows of solid black
      const rasterData = new Uint8Array(widthBytes * height);
      rasterData.fill(0xff);
      // Send as one chunk (480 bytes is small enough)
      await bleWrite(conn, rasterData, "raster-data");
      await delay(500);
      log(`   Rasterdata skickad (${rasterData.length} bytes, helsvart)`);

      // 7. Print-execute
      await send([0x1f, 0x11, 0x04, 0x00], "print-execute");

      // 8. CUPS footer
      await send([0x1f, 0xf0, 0x05, 0x00], "cups-footer-1");
      await send([0x1f, 0xf0, 0x03, 0x00], "cups-footer-2");

      // 9. ESC d (feed)
      await send([0x1b, 0x64, 0x02], "ESC d 2 (feed)");

      // 10. End-job
      await send([0x1f, 0x11, 0x03, 0x00], "end-job");

      log("");
      log(`Totalt ${responses.length} svar från skrivaren.`);
      try { await notifyChar.stopNotifications(); } catch { /* ok */ }
      log("Klart! Analysera svaren ovan för felkoder.");
    },
  },
  {
    id: "full-test-image",
    title: "Full testbild (ram + kryss)",
    description: "Skickar en komplett testbild med svart ram och kryss. Verifierar bildutskrift.",
    run: async (conn, log, chunkSize) => {
      const width = 384;
      const height = 240;
      const widthBytes = 48;

      log("Genererar testbild (384×240)...");
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, width, 6);
      ctx.fillRect(0, height - 6, width, 6);
      ctx.fillRect(0, 0, 6, height);
      ctx.fillRect(width - 6, 0, 6, height);
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#000000";
      ctx.beginPath();
      ctx.moveTo(10, 10);
      ctx.lineTo(width - 10, height - 10);
      ctx.moveTo(width - 10, 10);
      ctx.lineTo(10, height - 10);
      ctx.stroke();
      ctx.font = "bold 24px monospace";
      ctx.textAlign = "center";
      ctx.fillText("DEBUG OK", width / 2, height / 2 + 8);

      const imageData = ctx.getImageData(0, 0, width, height);

      log("Konverterar till monokrom...");
      const bitmap = new Uint8Array(widthBytes * height);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          const gray = imageData.data[i] * 0.299 + imageData.data[i + 1] * 0.587 + imageData.data[i + 2] * 0.114;
          if (gray < 128) {
            bitmap[y * widthBytes + Math.floor(x / 8)] |= 1 << (7 - (x % 8));
          }
        }
      }

      log("Init...");
      await bleWrite(conn, new Uint8Array([0x1b, 0x40]), "init");
      await delay(30);

      log("Raster header...");
      await bleWrite(
        conn,
        new Uint8Array([0x1d, 0x76, 0x30, 0x00, widthBytes, 0x00, height & 0xff, (height >> 8) & 0xff]),
        "raster-hdr"
      );

      log(`Skickar ${bitmap.length} bytes bilddata (chunk=${chunkSize})...`);
      for (let off = 0; off < bitmap.length; off += chunkSize) {
        await bleWrite(conn, bitmap.slice(off, Math.min(off + chunkSize, bitmap.length)), `img@${off}`);
        await delay(20);
      }

      await delay(300);
      log("Footer...");
      await bleWrite(
        conn,
        new Uint8Array([0x1f, 0xf0, 0x05, 0x00, 0x1f, 0xf0, 0x03, 0x00]),
        "footer"
      );
      await delay(500);
      log("Klart! En testbild med ram, kryss och 'DEBUG OK' bör ha skrivits ut.");
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
