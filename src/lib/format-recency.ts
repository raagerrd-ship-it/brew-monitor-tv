/** Format a timestamp as HH:mm if <24h ago, or dd/mm if older */
export function formatRecency(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const hours24 = 24 * 60 * 60 * 1000;

  if (diffMs < hours24) {
    return d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  }
  const day = d.getDate();
  const month = d.getMonth() + 1;
  return `${day}/${month}`;
}
