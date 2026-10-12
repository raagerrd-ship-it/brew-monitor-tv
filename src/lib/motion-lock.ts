// Rörelselås: medan något glider på TV:n sätts ingen state från nätet.
// Realtidshändelser köas (inga tappas) och spelas upp i ordning vid upplåsning;
// fetch väntar med att starta och med att leverera svaret tills låset släpps,
// så pollar som infaller under glidningen körs en gång efteråt.
import { useSyncExternalStore } from "react";
import { RealtimeChannel } from "@supabase/supabase-js";

const owners = new Set<string>();
const queue: Array<() => void> = [];
const listeners = new Set<(locked: boolean) => void>();
// Hårt tak: låset hålls aldrig längre än så här i följd, räknat från första lock().
export const MAX_LOCK_MS = 15_000;
let capTimer: ReturnType<typeof setTimeout> | null = null;

export const isLocked = () => owners.size > 0;

export function lock(owner: string) {
  const was = owners.size > 0;
  owners.add(owner);
  if (was) return;
  capTimer = setTimeout(() => {
    console.warn("[motionLock] tvångssläppt", [...owners]);
    release();
  }, MAX_LOCK_MS);
  listeners.forEach((l) => l(true));
}

export function unlock(owner: string) {
  if (owners.delete(owner) && owners.size === 0) release();
}

/** Släpper alla ägare och spelar upp kön. */
function release() {
  owners.clear();
  if (capTimer) clearTimeout(capTimer);
  capTimer = null;
  listeners.forEach((l) => l(false));
  // En batch: React 18 slår ihop uppdateringarna i samma uppgift.
  for (const fn of queue.splice(0)) {
    try { fn(); } catch (e) { console.error("[motionLock]", e); }
  }
}

export function whenUnlocked(fn: () => void) {
  if (owners.size === 0) fn();
  else queue.push(fn);
}

export function onMotionLockChange(l: (locked: boolean) => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

const untilUnlocked = () => new Promise<void>((r) => whenUnlocked(r));

export function useMotionLocked() {
  return useSyncExternalStore(onMotionLockChange, isLocked, () => false);
}

/** Kör callbacken direkt, eller köar anropet (med sina argument) tills låset släpps. */
export function gate<A extends unknown[]>(cb: (...args: A) => void) {
  return (...args: A) => whenUnlocked(() => cb(...args));
}

// Realtid: köa varje callback som kommer under låset.
const proto = RealtimeChannel.prototype as any;
const on = proto.on;
// sync_settings (force_tv_refresh_at, "Starta om TV") går alltid igenom.
const BYPASS_TABLE = "sync_settings";
proto.on = function (type: unknown, filter: any, cb?: unknown) {
  const bypass = filter?.table === BYPASS_TABLE;
  return on.call(this, type, filter, typeof cb === "function" && !bypass ? gate(cb as (...a: unknown[]) => void) : cb);
};

// Nätanrop: starta och leverera först när låset är släppt.
if (typeof window !== "undefined" && window.fetch) {
  // En dold sida glider inte: släpp allt.
  window.addEventListener("pagehide", release);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") release(); });
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes(`/rest/v1/${BYPASS_TABLE}`)) return orig(input, init);
    if (owners.size > 0) {
      await untilUnlocked();
      // Anroparens egen tidsgräns kan ha löpt ut medan vi väntade.
      if (init?.signal?.aborted) init = { ...init, signal: undefined };
    }
    const res = await orig(input, init);
    if (owners.size === 0) return res;
    const body = await res.arrayBuffer();
    await untilUnlocked();
    return new Response([101, 204, 205, 304].includes(res.status) ? null : body, { status: res.status, statusText: res.statusText, headers: res.headers });
  };
}
