import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimerFooter } from '@/components/TimerFooter';
import type { ExternalTimerState } from '@/hooks/use-external-timer';

const mocks = vi.hoisted(() => ({ timer: {} as ExternalTimerState, setFooterSlot: vi.fn(), clearFooterSlot: vi.fn(), showAlert: vi.fn(), dismissAlert: vi.fn() }));
vi.mock('@/hooks/use-external-timer', () => ({ useSharedExternalTimer: () => mocks.timer }));
vi.mock('@/hooks/use-external-user-settings', () => ({ useExternalUserSettings: () => ({ timerTvModeOnly: true }) }));
vi.mock('@/contexts/TvModeContext', () => ({ useTvMode: () => ({ isTvMode: true }) }));
vi.mock('@/contexts/AlbumArtContext', () => ({ useAlbumArt: () => ({ visibleBgUrl: null }) }));
vi.mock('@/contexts/DashboardFooterContext', () => ({ useDashboardFooter: () => mocks }));
vi.mock('@/contexts/DashboardAlertContext', () => ({ useDashboardAlert: () => mocks }));

function mount() {
  const view = render(<TimerFooter brewDay={null} />);
  act(() => vi.advanceTimersByTime(1000));
  return view;
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.timer = {
    isActive: true, label: 'Testtimer', remainingSeconds: 255, totalSeconds: 300,
    isPaused: false, pausedByMilestone: false, pausedAt: null, milestones: [],
    nextMilestone: null, timeToNextMilestone: null, progress: 15, nextConfig: null,
    wizardStep: null, recipeName: null, beerStyle: null, timerAction: null,
    timerTargetTemperature: null, wizardStartedAt: null, baseRemainingSeconds: 255,
  };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('TV timer footer content', () => {
  it('centres a single larger title and primary remaining time without empty rows or duplicate total', () => {
    mount();
    const title = screen.getByText('Testtimer');
    expect(title).toHaveClass('text-2xl', 'truncate');
    expect(title.parentElement?.parentElement?.children).toHaveLength(1);
    expect(screen.getByText('4:15')).toHaveClass('text-4xl');
    expect(screen.queryByText('Nästa:')).toBeNull();
    expect(screen.queryByText(/totalt/)).toBeNull();
    expect(screen.queryByText('om')).toBeNull();
  });

  it('keeps the badge, next milestone and small total with a larger om countdown', () => {
    mocks.timer.milestones = [
      { time: 280, label: 'Mäska in', current: true, action: 'heat', targetTemperature: 70 },
      { time: 120, label: 'Nästa tillsats' },
    ];
    mocks.timer.nextMilestone = mocks.timer.milestones[1];
    mocks.timer.timeToNextMilestone = 135;
    mount();
    expect(screen.getByText('2:15')).toHaveClass('text-4xl');
    expect(screen.getByText('om')).toHaveClass('text-sm');
    expect(screen.getByText('4:15 totalt')).toHaveClass('text-base');
    expect(screen.getByText('Värm till 70°C')).toBeInTheDocument();
    expect(screen.getByText('Nästa:')).toBeInTheDocument();
  });

  it.each([null, 0])('uses remaining as primary when the next countdown is %s', (next) => {
    mocks.timer.milestones = [{ time: 120, label: 'Tillsats' }];
    mocks.timer.timeToNextMilestone = next;
    mocks.timer.isPaused = true;
    mount();
    expect(screen.getByText('PAUSAD')).toBeInTheDocument();
    expect(screen.getByText('4:15')).toHaveClass('text-4xl');
    expect(screen.queryByText(/totalt/)).toBeNull();
  });

  it('preserves the next row in the done state', () => {
    mocks.timer.remainingSeconds = 0;
    mount();
    expect(screen.getByText('KLART')).toBeInTheDocument();
    expect(screen.getByText('Nästa:')).toBeInTheDocument();
    expect(screen.getByText('✓ Klart!')).toBeInTheDocument();
  });
});