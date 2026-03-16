/**
 * Phomemo M110 Thermal Printer Driver
 *
 * Standalone, reusable BLE driver for Phomemo M110/M120/M220 thermal printers.
 * No React, no app-specific dependencies, no hardcoded locale strings.
 *
 * Usage:
 *   import { connectPrinter, printBitmap, DEFAULT_PRINT_SETTINGS } from '@/lib/phomemo-driver';
 *
 *   const conn = await connectPrinter();
 *   await printBitmap(conn, myCanvas, 1, DEFAULT_PRINT_SETTINGS, (p) => {
 *     console.log(`${p.phase}: ${p.percent}%`);
 *   });
 *   disconnectPrinter(conn);
 */

// Types
export type {
  PrinterConnection,
  PrintProgress,
  PrintSettings,
  ProgressPhase,
  PrinterNotifyChannel,
  DeviceStorage,
} from './types';

// Constants
export {
  PRINTER_VERSION,
  SETTINGS_VERSION,
  DEFAULT_PRINT_SETTINGS,
  PRINT_WIDTH_PX,
  SERVICE_UUIDS,
  WRITE_CHAR_UUIDS,
  BLE_WRITE_TIMEOUT_MS,
  RECONNECT_TIMEOUT_MS,
} from './constants';

// Storage
export { createDeviceStorage, defaultStorage, migrateSettingsIfNeeded } from './storage';

// Connection
export {
  isBluetoothSupported,
  connectPrinter,
  reconnectLastPrinter,
  disconnectPrinter,
  delay,
} from './connection';

// Protocol
export { sendRasterJob, printBitmap, printBitmapBypassProcessing } from './protocol';

// Bitmap utilities
export { ditherToMonochrome, packThresholdBitmap, packDitheredPixels } from './bitmap';

// Debug
export { printDebugTestPattern, printTestPage } from './debug-pattern';
