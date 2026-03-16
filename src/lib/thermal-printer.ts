/**
 * Backward-compatible wrapper around phomemo-driver.
 *
 * All components/hooks continue importing from this file.
 * The standalone driver lives in ./phomemo-driver/ and can be
 * imported directly in other projects without this wrapper.
 *
 * This wrapper maps the driver's typed ProgressPhase enum
 * to the Swedish UI strings used throughout the app.
 */

import type {
  PrinterConnection,
  PrintSettings,
  PrintProgress as DriverProgress,
  ProgressPhase,
} from './phomemo-driver';

import {
  PRINTER_VERSION,
  SETTINGS_VERSION,
  DEFAULT_PRINT_SETTINGS,
  PRINT_WIDTH_PX,
  isBluetoothSupported,
  connectPrinter as driverConnect,
  reconnectLastPrinter as driverReconnect,
  disconnectPrinter,
  defaultStorage,
  migrateSettingsIfNeeded as driverMigrate,
  sendRasterJob as driverSendRasterJob,
  printBitmap as driverPrintBitmap,
  printBitmapBypassProcessing as driverPrintBitmapBypass,
  printDebugTestPattern as driverPrintDebug,
  printTestPage as driverPrintTestPage,
} from './phomemo-driver';

// ── Re-export types & constants unchanged ───────────────────────

export type { PrinterConnection, PrintSettings };
export { PRINTER_VERSION, SETTINGS_VERSION, DEFAULT_PRINT_SETTINGS, PRINT_WIDTH_PX };
export { isBluetoothSupported, disconnectPrinter };

// ── Legacy PrintProgress (phase is a string, not typed enum) ────

export interface PrintProgress {
  phase: string;
  percent: number;
}

// ── Swedish phase labels ────────────────────────────────────────

const PHASE_LABELS: Record<ProgressPhase, string> = {
  preparing: 'Förbereder bild...',
  connecting: 'Ansluter...',
  sending_settings: 'Skickar inställningar...',
  sending_header: 'Skickar raster-header...',
  printing: 'Skriver ut...',
  waiting: 'Väntar på utskrift...',
  finishing: 'Avslutar...',
  done: 'Klar!',
};

function mapProgress(
  onProgress: ((p: PrintProgress) => void) | undefined,
): ((p: DriverProgress) => void) | undefined {
  if (!onProgress) return undefined;
  return (p: DriverProgress) => {
    const label = PHASE_LABELS[p.phase] || p.phase;
    const detail = p.detail ? ` (${p.detail})` : '';
    onProgress({ phase: `${label}${detail}`, percent: p.percent });
  };
}

// ── Device persistence (delegates to defaultStorage) ────────────

export function getLastDeviceName(): string | null {
  return defaultStorage.getLastName();
}

export function setTargetPrinterName(name: string): void {
  try { localStorage.setItem('phomemo-last-device-name', name); } catch { /* ignore */ }
}

export function clearLastDevice(): void {
  defaultStorage.clear();
}

export function migrateSettingsIfNeeded(): boolean {
  return driverMigrate();
}

// ── Connection (pass default storage for backward compat) ───────

export async function connectPrinter(): Promise<PrinterConnection> {
  return driverConnect(defaultStorage);
}

export async function reconnectLastPrinter(): Promise<PrinterConnection | null> {
  return driverReconnect(defaultStorage);
}

// ── Printing (map progress to Swedish labels) ───────────────────

export async function sendRasterJob(
  connection: PrinterConnection,
  rasterData: Uint8Array,
  widthBytes: number,
  height: number,
  settings: PrintSettings = DEFAULT_PRINT_SETTINGS,
  onProgress?: (p: PrintProgress) => void,
  copyLabel: string = '',
): Promise<void> {
  return driverSendRasterJob(
    connection, rasterData, widthBytes, height, settings,
    mapProgress(onProgress),
    copyLabel || undefined,
  );
}

export async function printBitmap(
  connection: PrinterConnection,
  canvas: HTMLCanvasElement,
  copies: number = 1,
  settings: PrintSettings = DEFAULT_PRINT_SETTINGS,
  onProgress?: (p: PrintProgress) => void,
): Promise<void> {
  return driverPrintBitmap(connection, canvas, copies, settings, mapProgress(onProgress));
}

export async function printBitmapBypassProcessing(
  connection: PrinterConnection,
  canvas: HTMLCanvasElement,
  copies: number = 1,
  settings: PrintSettings = DEFAULT_PRINT_SETTINGS,
  onProgress?: (p: PrintProgress) => void,
): Promise<void> {
  return driverPrintBitmapBypass(connection, canvas, copies, settings, mapProgress(onProgress));
}

export async function printDebugTestPattern(
  connection: PrinterConnection,
  onProgress?: (p: PrintProgress) => void,
  settings: PrintSettings = DEFAULT_PRINT_SETTINGS,
): Promise<void> {
  return driverPrintDebug(connection, mapProgress(onProgress), settings);
}

export async function printTestPage(
  connection: PrinterConnection,
  onProgress?: (p: PrintProgress) => void,
): Promise<void> {
  return driverPrintTestPage(connection, mapProgress(onProgress));
}
