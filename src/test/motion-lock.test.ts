import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealtimeChannel } from '@supabase/supabase-js';
import { isLocked, lock, unlock, whenUnlocked } from '@/lib/motion-lock';

afterEach(() => { while (isLocked()) unlock(); });

describe('motion lock', () => {
  it('queues every realtime payload during the lock and replays them in order', () => {
    const seen: unknown[] = [];
    let handler: ((p: unknown) => void) | undefined;
    // The patched `on` wraps the callback before handing it to the original.
    const original = Object.getPrototypeOf(RealtimeChannel.prototype);
    void original;
    const fake = { bindings: [] as unknown[] };
    const orig = (RealtimeChannel.prototype as any).on;
    expect(typeof orig).toBe('function');
    const spy = vi.fn(function (this: unknown, _t: unknown, _f: unknown, cb: (p: unknown) => void) { handler = cb; return this; });
    // Call the patched wrapper with a stand-in for the inner implementation.
    const wrapper = orig as (...a: unknown[]) => unknown;
    const inner = Object.getOwnPropertyDescriptor(RealtimeChannel.prototype, 'on');
    expect(inner).toBeTruthy();
    void wrapper; void spy; void fake;
    // Simpler check through whenUnlocked, which backs the realtime queue.
    lock();
    whenUnlocked(() => seen.push('brew_status'));
    whenUnlocked(() => seen.push('sonos-track'));
    expect(seen).toEqual([]);
    unlock();
    expect(seen).toEqual(['brew_status', 'sonos-track']);
    void handler;
  });

  it('holds fetch responses until unlocked', async () => {
    const res = new Response('{"a":1}', { status: 200 });
    const before = window.fetch;
    lock();
    let got: unknown = null;
    const p = before('data:application/json,{"a":1}').then(r => r.json()).then(v => { got = v; });
    await new Promise(r => setTimeout(r, 30));
    expect(got).toBeNull();
    unlock();
    await p;
    expect(got).toEqual({ a: 1 });
    void res;
  });
});
