// Delar identiska GET-frågor mot databasen under uppstarten: frågor som är på
// väg samtidigt får samma svar. Färdiga svar cachas aldrig — omladdningar från
// återanslutning, visibilitychange, online och vakthunden hämtar alltid på nytt.
// Måste importeras före databasklienten.
const STARTUP_MS = 30_000;
const started = Date.now();
const orig = window.fetch.bind(window);
const inflight = new Map<string, Promise<Response>>();

window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (method !== "GET" || !url.includes("/rest/v1/") || Date.now() - started > STARTUP_MS) return orig(input, init);
  const h = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  const key = [url, h.get("accept"), h.get("prefer"), h.get("authorization")].join("|");
  const hit = inflight.get(key);
  if (hit) return hit.then((r) => r.clone());
  const p = orig(input, init);
  inflight.set(key, p);
  p.then(() => inflight.delete(key), () => inflight.delete(key));
  return p.then((r) => r.clone());
};
