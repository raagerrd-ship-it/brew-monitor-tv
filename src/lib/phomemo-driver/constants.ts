/**
 * Phomemo M110 Thermal Printer Driver — Constants
 */

import type { PrintSettings } from './types';

export const PRINTER_VERSION = 'v41-ack-synced-engine';

/** Settings version — bump to auto-reset aggressive user profiles */
export const SETTINGS_VERSION = 8;

export const SERVICE_UUIDS: readonly BluetoothServiceUUID[] = [
  '0000ff00-0000-1000-8000-00805f9b34fb',
  0xff00,
  0xffe0,
  0xae30,
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
];

export const WRITE_CHAR_UUIDS: readonly BluetoothCharacteristicUUID[] = [
  '0000ff02-0000-1000-8000-00805f9b34fb',
  0xff02,
  'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f',
  '49535343-8841-43f4-a8d4-ecbe34729bb3',
];

export const NOTIFY_CHAR_UUID = '0000ff03-0000-1000-8000-00805f9b34fb';
export const NOTIFY_SERVICE_UUID = '0000ff00-0000-1000-8000-00805f9b34fb';

export const BLE_WRITE_TIMEOUT_MS = 7000;
export const RECONNECT_TIMEOUT_MS = 10000;

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  mediaType: 'gap',
  landscape: false,
  speed: 3,
  density: 8,
  chunkSize: 100,
  chunkDelay: 0,
  throttleEvery: 0,
  throttleDelay: 0,
  sendSpeed: true,
  sendDensity: true,
  sendFooter: true,
};

/** Target print width in pixels for M110 */
export const PRINT_WIDTH_PX = 384;
