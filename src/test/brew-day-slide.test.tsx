import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { BrewDayCard } from '@/components/brew-card/BrewDayCard';
import { TimerFooter } from '@/components/TimerFooter';
import type { BrewDay } from '@/hooks/use-brew-day';

const state = vi.hoisted(() => ({
  timer: { isActive: true, totalSeconds: 3600, remainingSeconds: 1800, timeToNextMilestone: 900, nextMilestone: { time: 900, label: 'Citra' }, milestones: [], label: 'Kok', isPaused: false } as any,
  setSlot: vi.fn(), clearSlot: vi.fn(), showAlert: vi.fn(), dismissAlert: vi.fn(),
}));
vi.mock('@/hooks/use-external-timer', () => ({ useSharedExternalTimer: () => state.timer }));
vi.mock('@/hooks/use-external-user-settings', () => ({ useExternalUserSettings: () => ({ timerTvModeOnly: true }) }));
vi.mock('@/contexts/TvModeContext', () => ({ useTvMode: () => ({ isTvMode: true }) }));
vi.mock('@/contexts/AlbumArtContext', () => ({ useAlbumArt: () => ({ visibleBgUrl: null }) }));
vi.mock('@/contexts/DashboardFooterContext', () => ({ useDashboardFooter: () => ({ setFooterSlot: state.setSlot, clearFooterSlot: state.clearSlot }) }));
vi.mock('@/contexts/DashboardAlertContext', () => ({ useDashboardAlert: () => ({ showAlert: state.showAlert, dismissAlert: state.dismissAlert }) }));

const day: BrewDay = {
  recipe_name: 'Mätbrygd', step_title: 'Kok', step_kind: 'boil', target_temp_c: 100,
  items: [{ id: 'citra', name: 'Citra', amount: 30, unit: 'g', at_min: 15, checked: false }],
  updated_at: '', step_index: 1, step_count: 3, next_step_title: 'Whirlpool', next_step_minutes: 20, next_step_items: 1, step_started_at: null,
};
afterEach(() => vi.useRealTimers());

describe('brew day slide', () => {
  it('freezes the card countdown while the shared timer continues and catches up afterwards', () => {
    state.timer = { ...state.timer, isActive: true, timeToNextMilestone: 900 };
    const view = render(<BrewDayCard day={day} isTvMode />);
    expect(screen.getByText('15:00', { exact: false })).toBeTruthy();
    view.rerender(<BrewDayCard day={day} isTvMode transitionActive />);
    state.timer = { ...state.timer, timeToNextMilestone: 895 };
    view.rerender(<BrewDayCard day={day} isTvMode transitionActive />);
    expect(screen.getByText('15:00', { exact: false })).toBeTruthy();
    view.rerender(<BrewDayCard day={day} isTvMode />);
    expect(screen.getByText('14:55', { exact: false })).toBeTruthy();
  });

  it('reserves height during preparation but waits for the footer phase to enter', () => {
    vi.useFakeTimers();
    state.timer = { ...state.timer, isActive: true };
    const view = render(<TimerFooter brewDay={day} slidePhase="prepare" />);
    expect(state.setSlot).toHaveBeenCalledWith(null, 112, 'brew-timer');
    act(() => vi.advanceTimersByTime(3000));
    const footer = view.container.querySelector('.bottom-0') as HTMLElement;
    expect(footer.style.transform).toBe('translateY(100%)');
    view.rerender(<TimerFooter brewDay={day} slidePhase="footer" />);
    act(() => vi.advanceTimersByTime(100));
    expect(footer.style.transform).toBe('translateY(0)');
    state.timer = { ...state.timer, isActive: false };
    view.rerender(<TimerFooter brewDay={null} slidePhase="prepare" />);
    expect(state.clearSlot).toHaveBeenCalledWith('brew-timer');
    expect(footer.style.transform).toBe('translateY(0)');
    view.rerender(<TimerFooter brewDay={null} slidePhase="footer" />);
    act(() => vi.advanceTimersByTime(10));
    expect(footer.style.transform).toBe('translateY(100%)');
  });
});