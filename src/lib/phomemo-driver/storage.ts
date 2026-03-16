/**
 * Phomemo M110 Thermal Printer Driver — Device Persistence
 *
 * Namespaced localStorage wrapper for remembering the last connected device.
 */

import type { DeviceStorage } from './types';

export function createDeviceStorage(prefix = 'phomemo'): DeviceStorage {
  const nameKey = `${prefix}-last-device-name`;
  const idKey = `${prefix}-last-device-id`;

  return {
    getLastName: () => {
      try { return localStorage.getItem(nameKey); } catch { return null; }
    },
    getLastId: () => {
      try { return localStorage.getItem(idKey); } catch { return null; }
    },
    setLast: (device: BluetoothDevice) => {
      try {
        if (device?.name) localStorage.setItem(nameKey, device.name);
        if (device?.id) localStorage.setItem(idKey, device.id);
      } catch { /* ignore */ }
    },
    clear: () => {
      try {
        localStorage.removeItem(nameKey);
        localStorage.removeItem(idKey);
      } catch { /* ignore */ }
    },
  };
}

/** Default storage instance (backward compatible keys) */
export const defaultStorage = createDeviceStorage('phomemo');

/**
 * Check if saved settings need auto-reset (version migration).
 */
export function migrateSettingsIfNeeded(prefix = 'phomemo', currentVersion = 8): boolean {
  const versionKey = `${prefix}-settings-version`;
  const settingsKey = `${prefix}-print-settings`;
  try {
    const savedVersion = Number(localStorage.getItem(versionKey) || '0');
    if (savedVersion < currentVersion) {
      localStorage.removeItem(settingsKey);
      localStorage.setItem(versionKey, String(currentVersion));
      console.log(`[Printer] Settings migrated v${savedVersion} → v${currentVersion}, reset to safe defaults`);
      return true;
    }
  } catch { /* ignore */ }
  return false;
}
