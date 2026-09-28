const STORAGE_KEY = 'device_key';

export function captureDeviceKey(): void {
  const url = new URL(window.location.href);
  const k = url.searchParams.get('k');
  if (!k) return;
  try { localStorage.setItem(STORAGE_KEY, k); } catch { /* ignore */ }
  url.searchParams.delete('k');
  history.replaceState(history.state, '', url.pathname + url.search + url.hash);
}

export function getDeviceKey(): string | null {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

export function deviceHeaders(): Record<string, string> {
  const key = getDeviceKey();
  return key ? { 'x-device-key': key } : {};
}
