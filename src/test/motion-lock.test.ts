import { afterEach, describe, expect, it, vi } from 'vitest';
import { gate, isLocked, lock, unlock, MAX_LOCK_MS } from '@/lib/motion-lock';

afterEach(() => { unlock('brew-day'); unlock('cleaning'); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('motion lock', () => {
  it('queues every realtime payload during the lock and replays them in order', () => {
    const seen: string[] = [];
    const onBrew = gate((p: { status: string }) => seen.push(p.status));
    const onSonos = gate((p: { track: string }) => seen.push(p.track));
    onBrew({ status: 'before' });
    lock('brew-day');
    onBrew({ status: 'Jäsning' });
    onSonos({ track: 'Ny låt' });
    expect(seen).toEqual(['before']);
    unlock('brew-day');
    expect(seen).toEqual(['before', 'Jäsning', 'Ny låt']);
  });

  it('force-releases after 15 s and replays the queue', () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen: string[] = [];
    lock('brew-day');
    gate(() => seen.push('x'))();
    vi.advanceTimersByTime(MAX_LOCK_MS - 1);
    expect(isLocked()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(isLocked()).toBe(false);
    expect(seen).toEqual(['x']);
    expect(warn).toHaveBeenCalledWith('[motionLock] tvångssläppt', ['brew-day']);
  });

  it('a double lock from one owner is released by one unlock; other owners stay', () => {
    lock('brew-day'); lock('brew-day');
    unlock('brew-day');
    expect(isLocked()).toBe(false);
    lock('brew-day'); lock('cleaning');
    unlock('brew-day');
    expect(isLocked()).toBe(true);
    unlock('cleaning');
    expect(isLocked()).toBe(false);
  });

  it('releases when the page is hidden', () => {
    lock('cleaning');
    window.dispatchEvent(new Event('pagehide'));
    expect(isLocked()).toBe(false);
  });

  it('lets the TV restart signal (sync_settings) through while locked', async () => {
    lock('brew-day');
    let got = false;
    const p = window.fetch('data:application/json,{}#/rest/v1/sync_settings').then(() => { got = true; });
    await p;
    expect(got).toBe(true);
    expect(isLocked()).toBe(true);
  });

  it('holds other fetches until unlocked', async () => {
    lock('brew-day');
    let got: unknown = null;
    const p = window.fetch('data:application/json,{"a":1}').then(r => r.json()).then(v => { got = v; });
    await new Promise(r => setTimeout(r, 30));
    expect(got).toBeNull();
    unlock('brew-day');
    await p;
    expect(got).toEqual({ a: 1 });
  });
});
