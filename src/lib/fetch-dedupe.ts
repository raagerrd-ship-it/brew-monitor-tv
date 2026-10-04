// Delar identiska GET-frågor mot databasen under uppstarten: samtidiga eller inom
// REUSE_MS efter varandra får samma svar. Måste importeras före databasklienten.
const STARTUP_MS = 30_000;
const REUSE_MS = 3_000;
const started = Date.now();
const orig = window.fetch.bind(window);
const cache = new Map<string, { at: number; p: Promise<Response> }>();

window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (method !== "GET" || !url.includes("/rest/v1/") || Date.now() - started > STARTUP_MS) return orig(input, init);
  const h = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  const key = [url, h.get("accept"), h.get("prefer"), h.get("authorization")].join("|");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < REUSE_MS) return hit.p.then((r) => r.clone());
  const p = orig(input, init);
  cache.set(key, { at: Date.now(), p });
  p.then(() => { const e = cache.get(key); if (e) e.at = Date.now(); }, () => cache.delete(key));
  return p.then((r) => r.clone());
};
