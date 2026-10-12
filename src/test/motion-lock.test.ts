import { afterEach, describe, expect, it } from 'vitest';
import { gate, isLocked, lock, unlock } from '@/lib/motion-lock';

afterEach(() => { while (isLocked()) unlock(); });

describe('motion lock', () => {
  it('queues every realtime payload during the lock and replays them in order', () => {
    const seen: string[] = [];
    const onBrew = gate((p: { status: string }) => seen.push(p.status));
    const onSonos = gate((p: { track: string }) => seen.push(p.track));
    onBrew({ status: 'before' });
    lock();
    onBrew({ status: 'Jäsning' });
    onSonos({ track: 'Ny låt' });
    onBrew({ status: 'Kallkrasch' });
    expect(seen).toEqual(['before']);
    unlock();
    expect(seen).toEqual(['before', 'Jäsning', 'Ny låt', 'Kallkrasch']);
  });

  it('holds fetch until unlocked and then delivers the response', async () => {
    lock();
    let got: unknown = null;
    const p = window.fetch('data:application/json,{"a":1}').then(r => r.json()).then(v => { got = v; });
    await new Promise(r => setTimeout(r, 30));
    expect(got).toBeNull();
    unlock();
    await p;
    expect(got).toEqual({ a: 1 });
  });
});
