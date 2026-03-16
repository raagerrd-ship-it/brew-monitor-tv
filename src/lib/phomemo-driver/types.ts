/**
 * Phomemo M110 Thermal Printer Driver — Type Definitions
 *
 * Standalone types with no app-specific dependencies.
 */

export interface PrinterConnection {
  device: BluetoothDevice;
  characteristic: BluetoothRemoteGATTCharacteristic;
  writeMethod: 'withoutResponse' | 'withResponse';
}

export type ProgressPhase =
  | 'preparing'
  | 'connecting'
  | 'sending_settings'
  | 'sending_header'
  | 'printing'
  | 'waiting'
  | 'finishing'
  | 'done';

export interface PrintProgress {
  phase: ProgressPhase;
  percent: number;
  detail?: string; // e.g. "copy 2/3"
}

export interface PrintSettings {
  mediaType: 'none' | 'gap' | 'continuous' | 'mark';
  landscape: boolean;
  speed: number;        // 1-5
  density: number;      // 1-15 (M110 range)
  chunkSize: number;    // bytes per BLE write
  chunkDelay: number;   // ms between chunks
  throttleEvery: number; // extra pause every N chunks
  throttleDelay: number; // ms for that extra pause
  sendSpeed: boolean;
  sendDensity: boolean;
  sendFooter: boolean;
}

export type PrinterNotifyChannel = {
  clear: () => void;
  waitForPacket: (label: string, timeoutMs?: number) => Promise<Uint8Array | null>;
  stop: () => Promise<void>;
};

export interface DeviceStorage {
  getLastName: () => string | null;
  getLastId: () => string | null;
  setLast: (device: BluetoothDevice) => void;
  clear: () => void;
}
