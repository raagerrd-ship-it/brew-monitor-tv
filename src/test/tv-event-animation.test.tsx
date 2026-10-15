import { useRef } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTvEventAnimation } from '@/hooks/use-tv-event-animation';
import { lock, unlock } from '@/lib/motion-lock';
import { SonosTrackText } from '@/components/sonos/SonosTrackText';
import { RelayIcon } from '@/components/header/RelayIcon';

function Harness({ value, enabled = true }: { value: number | null; enabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useTvEventAnimation(ref, value, 'tv-event-sweep', enabled);
  return <div ref={ref} data-testid="effect" />;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(fn, 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
});
afterEach(() => { cleanup(); unlock('test'); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('TV one-shot feedback', () => {
  it('skips mount, runs once on change, removes itself on finish and ignores unchanged values', () => {
    const view = render(<Harness value={1} />);
    const el = view.getByTestId('effect');
    act(() => vi.advanceTimersByTime(20));
    expect(el).not.toHaveClass('tv-event-sweep');
    view.rerender(<Harness value={2} />);
    act(() => vi.advanceTimersByTime(20));
    expect(el).toHaveClass('tv-event-sweep');
    fireEvent.animationEnd(el);
    expect(el).not.toHaveClass('tv-event-sweep');
    view.rerender(<Harness value={2} />);
    act(() => vi.advanceTimersByTime(20));
    expect(el).not.toHaveClass('tv-event-sweep');
  });
  it('skips initial data and disabled effects', () => {
    const view = render(<Harness value={null} />);
    view.rerender(<Harness value={1} />);
    act(() => vi.advanceTimersByTime(20));
    expect(view.getByTestId('effect')).not.toHaveClass('tv-event-sweep');
    view.rerender(<Harness value={2} enabled={false} />);
    act(() => vi.advanceTimersByTime(20));
    expect(view.getByTestId('effect')).not.toHaveClass('tv-event-sweep');
  });
  it('skips locked changes and cancels an effect when motion starts', () => {
    const view = render(<Harness value={1} />);
    act(() => lock('test'));
    view.rerender(<Harness value={2} />);
    act(() => vi.advanceTimersByTime(20));
    expect(view.getByTestId('effect')).not.toHaveClass('tv-event-sweep');
    act(() => unlock('test'));
    view.rerender(<Harness value={3} />);
    act(() => vi.advanceTimersByTime(20));
    expect(view.getByTestId('effect')).toHaveClass('tv-event-sweep');
    act(() => lock('test'));
    expect(view.getByTestId('effect')).not.toHaveClass('tv-event-sweep');
  });
  it('retains the outgoing title on track change but does not animate the initial track', () => {
    const view = render(<SonosTrackText identity="one" enabled><span>First</span></SonosTrackText>);
    expect(view.container.querySelector('.tv-track-exit')).toBeNull();
    view.rerender(<SonosTrackText identity="two" enabled><span>Second</span></SonosTrackText>);
    act(() => vi.advanceTimersByTime(20));
    expect(view.container.querySelector('.tv-track-exit')).toHaveTextContent('First');
    expect(view.container.querySelector('.tv-track-enter')).toHaveTextContent('Second');
  });
  it('pops the relay only on a reported change', () => {
    const view = render(<RelayIcon on={false} isTvMode />);
    expect(view.container.querySelector('.tv-relay-pop')).toBeNull();
    view.rerender(<RelayIcon on={true} isTvMode />);
    act(() => vi.advanceTimersByTime(20));
    expect(view.container.querySelector('.tv-relay-pop')).toBeTruthy();
  });
});