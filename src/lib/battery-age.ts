/** Batteriavläsningar äldre än en timme räknas som gamla. */
export const BATTERY_STALE_MIN = 60;

export function batteryAgeMinutes(lastUpdate: string | null | undefined): number {
  if (!lastUpdate) return Infinity;
  return (Date.now() - new Date(lastUpdate).getTime()) / 60000;
}

export function isBatteryStale(lastUpdate: string | null | undefined): boolean {
  return batteryAgeMinutes(lastUpdate) > BATTERY_STALE_MIN;
}

/** "igår 15:30" / "15:30" / "12/9 15:30" */
export function batteryAgeLabel(lastUpdate: string | null | undefined): string {
  if (!lastUpdate) return "okänd tid";
  const d = new Date(lastUpdate);
  const time = d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const days = Math.floor((startOfToday.getTime() - d.getTime()) / 86400000) + (d < startOfToday ? 1 : 0);
  if (d >= startOfToday) return time;
  if (days === 1) return `igår ${time}`;
  return `${d.getDate()}/${d.getMonth() + 1} ${time}`;
}
