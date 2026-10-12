// Rörelselås: medan något glider på TV:n sätts ingen state från nätet.
// Realtidshändelser köas (inga tappas) och spelas upp i ordning vid upplåsning;
// fetch väntar med att starta och med att leverera svaret tills låset släpps,
// så pollar som infaller under glidningen körs en gång efteråt.
import { useSyncExternalStore } from "react";
import { RealtimeChannel } from "@supabase/supabase-js";

let count = 0;
const queue: Array<() => void> = [];
const listeners = new Set<(locked: boolean) => void>();

export const isLocked = () => count > 0;

export function lock() {
  if (count++ === 0) listeners.forEach((l) => l(true));
}

export function unlock() {
  if (count === 0 || --count > 0) return;
  listeners.forEach((l) => l(false));
  // En batch: React 18 slår ihop uppdateringarna i samma uppgift.
  for (const fn of queue.splice(0)) {
    try { fn(); } catch (e) { console.error("[motionLock]", e); }
  }
}

export function whenUnlocked(fn: () => void) {
  if (count === 0) fn();
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

// Realtid: köa varje callback som kommer under låset.
const proto = RealtimeChannel.prototype as any;
const on = proto.on;
proto.on = function (type: unknown, filter: unknown, cb?: unknown) {
  const gated = typeof cb === "function"
    ? (...args: unknown[]) => (count > 0 ? queue.push(() => (cb as any)(...args)) : (cb as any)(...args))
    : cb;
  return on.call(this, type, filter, gated);
};

// Nätanrop: starta och leverera först när låset är släppt.
if (typeof window !== "undefined" && window.fetch) {
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (count > 0) {
      await untilUnlocked();
      // Anroparens egen tidsgräns kan ha löpt ut medan vi väntade.
      if (init?.signal?.aborted) init = { ...init, signal: undefined };
    }
    const res = await orig(input, init);
    if (count === 0) return res;
    const body = await res.arrayBuffer();
    await untilUnlocked();
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  };
}
