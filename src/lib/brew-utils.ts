// Re-export from focused modules for backward compatibility
export { DEFAULT_DEVICE_COLOR, hslToRgb } from "./color-utils";
export { findDevicesForBrew } from "./device-matching";
export type { DeviceMatch } from "./device-matching";
export { calculateFermentationRate, calculateFermentationTrend, formatRunTime } from "./fermentation-calc";
