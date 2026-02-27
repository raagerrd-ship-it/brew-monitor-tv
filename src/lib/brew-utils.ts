// Re-export from focused modules for backward compatibility
export { colorKeywords, getControllerColor, hslToRgb } from "./color-utils";
export { findDevicesForBrew } from "./device-matching";
export type { DeviceMatch } from "./device-matching";
export { calculateFermentationRate, calculateFermentationTrend, formatRunTime } from "./fermentation-calc";
