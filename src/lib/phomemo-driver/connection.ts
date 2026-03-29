/**
 * Phomemo M110 Thermal Printer Driver — BLE Connection
 *
 * Handles device discovery, GATT connection, service/characteristic
 * resolution, silent reconnect via watchAdvertisements, and disconnect.
 */

import type { PrinterConnection, PrinterNotifyChannel, DeviceStorage } from './types';
import {
  SERVICE_UUIDS,
  WRITE_CHAR_UUIDS,
  NOTIFY_SERVICE_UUID,
  NOTIFY_CHAR_UUID,
  BLE_WRITE_TIMEOUT_MS,
  RECONNECT_TIMEOUT_MS,
} from './constants';
import { defaultStorage } from './storage';

// ── Debug log emitter ───────────────────────────────────────────

export type BleDebugEntry = {
  ts: number;
  ctx: string;
  bytes: number;
  hex: string;        // first 32 bytes as hex
  direction: 'out' | 'in';
};

type BleDebugListener = (entry: BleDebugEntry) => void;
const debugListeners = new Set<BleDebugListener>();

export function subscribeBleDebug(listener: BleDebugListener): () => void {
  debugListeners.add(listener);
  return () => { debugListeners.delete(listener); };
}

function emitDebug(entry: BleDebugEntry) {
  debugListeners.forEach(l => l(entry));
}

// ── Utilities ───────────────────────────────────────────────────

export function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export function toHex(data: Uint8Array): string {
  return Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

export function isBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

// ── BLE Write Primitives ────────────────────────────────────────

export async function bleWrite(
  conn: PrinterConnection,
  data: Uint8Array,
  ctx: string,
  mode: 'auto' | 'forceNoResponse' | 'forceWithResponse' = 'auto',
): Promise<void> {
  const arr = new Uint8Array(data);
  const buffer = arr.buffer;
  const supportsNoResponse = !!conn.characteristic.properties.writeWithoutResponse;
  const supportsWithResponse = !!conn.characteristic.properties.write;
  const useNoResponse = mode === 'forceNoResponse'
    ? supportsNoResponse
    : (mode === 'forceWithResponse' ? false : (conn.writeMethod === 'withoutResponse' && supportsNoResponse));
  const useWithResponse = mode === 'forceWithResponse' && supportsWithResponse;

  // Emit debug entry (truncate hex to first 32 bytes)
  if (debugListeners.size > 0) {
    const preview = arr.slice(0, 32);
    emitDebug({
      ts: performance.now(),
      ctx,
      bytes: arr.length,
      hex: toHex(preview) + (arr.length > 32 ? ` …(${arr.length - 32} more)` : ''),
      direction: 'out',
    });
  }

  const p = (useNoResponse && !useWithResponse)
    ? conn.characteristic.writeValueWithoutResponse(buffer)
    : conn.characteristic.writeValue(buffer);
  await Promise.race([p, delay(BLE_WRITE_TIMEOUT_MS).then(() => { throw new Error(`BLE timeout: ${ctx}`); })]);
}

/** Send a byte buffer in chunks over BLE */
export async function sendChunked(
  conn: PrinterConnection,
  data: Uint8Array,
  chunkSize: number,
  chunkDelay: number,
  throttleEvery: number,
  throttleDelay: number,
  onProgress?: (sent: number, total: number) => void,
): Promise<void> {
  const total = data.length;
  let chunkCount = 0;

  for (let offset = 0; offset < total; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, total);
    await bleWrite(conn, data.slice(offset, end), `chunk@${offset}`);
    onProgress?.(end, total);
    chunkCount++;

    if (end < total && chunkDelay > 0) await delay(chunkDelay);
    if (end < total && throttleEvery > 0 && throttleDelay > 0 && chunkCount % throttleEvery === 0) {
      await delay(throttleDelay);
    }
  }
}

// ── Notify Channel ──────────────────────────────────────────────

export async function setupNotifyChannel(
  conn: PrinterConnection,
  onLog?: (msg: string) => void,
): Promise<PrinterNotifyChannel | null> {
  try {
    const service = conn.characteristic?.service
      ?? await conn.device.gatt?.getPrimaryService(NOTIFY_SERVICE_UUID);
    if (!service) return null;

    const notifyChar = await service.getCharacteristic(NOTIFY_CHAR_UUID);
    const queue: Uint8Array[] = [];

    const onNotify = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      const value = target?.value;
      if (!value) return;
      const bytes = new Uint8Array(value.buffer.slice(0));
      queue.push(bytes);
      onLog?.(`[Printer][ACK] raw: ${toHex(bytes)}`);
      if (debugListeners.size > 0) {
        emitDebug({
          ts: performance.now(),
          ctx: 'ACK',
          bytes: bytes.length,
          hex: toHex(bytes),
          direction: 'in',
        });
      }
    };

    notifyChar.addEventListener('characteristicvaluechanged', onNotify as EventListener);
    await notifyChar.startNotifications();
    onLog?.('[Printer] Notify channel active');

    return {
      clear: () => { queue.length = 0; },
      waitForPacket: async (label: string, timeoutMs = 4000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const pkt = queue.shift();
          if (pkt) {
            onLog?.(`[Printer][ACK] ${label}: ${toHex(pkt)}`);
            return pkt;
          }
          await delay(40);
        }
        onLog?.(`[Printer][ACK] ${label}: timeout after ${timeoutMs}ms`);
        return null;
      },
      stop: async () => {
        try { notifyChar.removeEventListener('characteristicvaluechanged', onNotify as EventListener); } catch { /* ignore */ }
        try { await notifyChar.stopNotifications(); } catch { /* ignore */ }
      },
    };
  } catch (e: any) {
    onLog?.(`[Printer] Notify channel unavailable: ${e?.message || 'unknown error'}`);
    return null;
  }
}

// ── Device Connection ───────────────────────────────────────────

async function connectWithRetry(device: BluetoothDevice, retries = 3): Promise<BluetoothRemoteGATTServer> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) await delay(800 * attempt);
      const server = await device.gatt!.connect();
      await delay(100);
      return server;
    } catch (e) {
      console.warn(`[Printer] GATT attempt ${attempt + 1} failed:`, e);
      if (attempt >= retries) throw new Error('Could not connect to printer via GATT.');
    }
  }
  throw new Error('Connection failed.');
}

async function connectDevice(device: BluetoothDevice, storage: DeviceStorage): Promise<PrinterConnection> {
  const server = await connectWithRetry(device);

  let service: BluetoothRemoteGATTService | null = null;
  let matchedServiceUuid: BluetoothServiceUUID | null = null;
  for (const uuid of SERVICE_UUIDS) {
    try { service = await server.getPrimaryService(uuid); matchedServiceUuid = uuid; break; } catch { /* next */ }
  }
  if (!service) throw new Error('Could not find printer BLE service.');
  console.log(`[Printer] Matched service: ${matchedServiceUuid}`);

  let characteristic: BluetoothRemoteGATTCharacteristic | null = null;
  let matchedCharUuid: BluetoothCharacteristicUUID | null = null;
  for (const uuid of WRITE_CHAR_UUIDS) {
    try { characteristic = await service.getCharacteristic(uuid); matchedCharUuid = uuid; break; } catch { /* next */ }
  }
  if (!characteristic) throw new Error('Could not find printer BLE characteristic.');

  const writeMethod: 'withResponse' | 'withoutResponse' =
    characteristic.properties.writeWithoutResponse ? 'withoutResponse' : 'withResponse';

  console.log(`[Printer] Connected: ${device.name}, service=${matchedServiceUuid}, char=${matchedCharUuid}, write=${writeMethod}`);
  storage.setLast(device);
  return { device, characteristic, writeMethod };
}

/**
 * Silently reconnect to the last-used printer via watchAdvertisements.
 * Returns null if no saved device or reconnection fails.
 */
export async function reconnectLastPrinter(storage: DeviceStorage = defaultStorage): Promise<PrinterConnection | null> {
  if (!isBluetoothSupported()) return null;
  const lastName = storage.getLastName();
  const lastId = storage.getLastId();
  if (!lastName && !lastId) return null;

  try {
    if (!navigator.bluetooth?.getDevices) return null;

    const devices = await navigator.bluetooth.getDevices();
    const target = devices.find(
      d => (lastId && d.id === lastId) || (lastName && d.name === lastName),
    );
    if (!target) return null;
    if (target.gatt?.connected) return await connectDevice(target, storage);

    if (target.watchAdvertisements) {
      const received = await new Promise<boolean>(resolve => {
        let done = false;
        const handler = () => { if (done) return; done = true; clearTimeout(t); target.removeEventListener('advertisementreceived', handler); resolve(true); };
        const t = setTimeout(() => { if (done) return; done = true; target.removeEventListener('advertisementreceived', handler); resolve(false); }, RECONNECT_TIMEOUT_MS);
        target.addEventListener('advertisementreceived', handler);
        target.watchAdvertisements().catch(() => {});
      });
      if (received) await delay(120);
    } else {
      await delay(250);
    }

    if (!target.gatt) return null;
    return await connectDevice(target, storage);
  } catch (e: any) {
    console.warn('[Printer] Auto-reconnect failed:', e.message);
    return null;
  }
}

/**
 * Open the browser BLE picker and connect to a Phomemo printer.
 */
export async function connectPrinter(storage: DeviceStorage = defaultStorage): Promise<PrinterConnection> {
  if (!isBluetoothSupported()) {
    throw new Error('Web Bluetooth is not supported in this browser.');
  }
  let device: BluetoothDevice;
  try {
    device = await navigator.bluetooth!.requestDevice({
      filters: [
        { namePrefix: 'M' }, { namePrefix: 'D' }, { namePrefix: 'P' },
        { namePrefix: 'Q' }, { namePrefix: 'T' }, { namePrefix: 'A' },
        { namePrefix: 'Mr.in' }, { namePrefix: 'Phomemo' },
      ],
      optionalServices: [...SERVICE_UUIDS],
    });
  } catch {
    device = await navigator.bluetooth!.requestDevice({
      acceptAllDevices: true,
      optionalServices: [...SERVICE_UUIDS],
    });
  }
  return connectDevice(device, storage);
}

/**
 * Disconnect from the printer.
 */
export function disconnectPrinter(connection: PrinterConnection): void {
  try { connection.device.gatt?.disconnect(); } catch { /* ignore */ }
}
