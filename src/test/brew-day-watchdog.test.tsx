import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { BrewingDashboard } from '@/components/BrewingDashboard';
import { isLocked } from '@/lib/motion-lock';

const state = vi.hoisted(() => ({ day: null as null | { recipe_name: string; items: never[] } }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/hooks/use-brew-day', () => ({ useBrewDay: () => state.day }));
vi.mock('@/hooks/use-brew-data', () => ({ useBrewData: () => ({ brews: [], pills: [], controllers: [], loading: false, updatedFields: {}, isAuthenticated: true }) }));
vi.mock('@/hooks/use-brew-carousel', () => ({ useBrewCarousel: () => ({ isMobile: false, isTvMode: true, shouldUseCarousel: false }) }));
vi.mock('@/hooks/use-cleaning-checklist', () => ({ useCleaningChecklist: () => ({ view: null }) }));
vi.mock('@/hooks/use-splash-screen', () => ({ useSplashScreen: () => ({ showSplash: false }) }));
vi.mock('@/hooks/use-tv-refresh', () => ({ useTvRefresh: () => {} }));
vi.mock('@/hooks/use-external-timer', () => ({ ExternalTimerProvider: ({ children }: any) => children }));
vi.mock('@/contexts/AlbumArtContext', () => ({ useHasAlbumArtBackground: () => false }));
vi.mock('@/contexts/DashboardFooterContext', () => ({ useDashboardFooter: () => ({ footerHeight: 0 }) }));
vi.mock('@/components/AspectRatioContainer', () => ({ useAspectRatio: () => ({ isLocked: true, height: 1080 }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: () => ({ select: () => ({ eq: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) } }));
vi.mock('@/components/DashboardHeader', () => ({ DashboardHeader: () => null, HEADER_HEIGHT: 180, HEADER_HEIGHT_TV: 56 }));
vi.mock('@/components/TimerFooter', () => ({ TimerFooter: () => null }));
vi.mock('@/components/brew-card/BrewDayCard', () => ({ BrewDayCard: ({ transitionActive }: any) => <output data-testid="transition">{String(transitionActive)}</output> }));
vi.mock('@/components/brew-card/BrewCard', () => ({ BrewCard: () => null }));
vi.mock('@/components/brew-card/BrewCardSkeleton', () => ({ BrewCardSkeleton: () => null }));
vi.mock('@/components/RaptControllerDialog', () => ({ RaptControllerDialog: () => null }));
vi.mock('@/components/DashboardBackground', () => ({ DashboardBackground: () => null }));
vi.mock('@/components/DashboardAlertOverlay', () => ({ DashboardAlertOverlay: () => null }));
vi.mock('@/components/CleaningChecklistOverlay', () => ({ CleaningChecklistOverlay: () => null }));

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); state.day = null; });

describe('brew day phase watchdog', () => {
  it('finishes entry and exit without any transitionend events and releases the motion lock', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    state.day = { recipe_name: 'Mätbrygd', items: [] };
    const view = render(<BrewingDashboard />);
    const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
    const transition = () => screen.queryByTestId('transition')?.textContent;
    const card = () => view.container.querySelector('.absolute.motion-reduce\\:\\!transition-none') as HTMLElement;
    expect(isLocked()).toBe(true);
    expect(card().style.transform).toBe('translateX(calc(100% + 1.5rem))');
    // prepare 700, row 1200+1500 then 300 pause, card 1400+1500 then 400 pause
    advance(700); advance(2700); advance(300);
    expect(card().style.transform).toBe('translateX(0)');
    expect(transition()).toBe('true');
    advance(2900); advance(399);
    expect(transition()).toBe('true');
    expect(isLocked()).toBe(true);
    advance(1);
    expect(transition()).toBe('false');
    expect(isLocked()).toBe(false);
    expect(view.container.querySelector('.cleaning-transition-active')).toBeNull();

    state.day = null;
    view.rerender(<BrewingDashboard />);
    expect(isLocked()).toBe(true);
    // prepare 700, card 1200+1500 then 200, row 1200+1500 then 300
    advance(700); advance(2700); advance(200); advance(2700); advance(299);
    expect(transition()).toBe('true');
    advance(1);
    expect(screen.queryByTestId('transition')).toBeNull();
    expect(isLocked()).toBe(false);
    expect(view.container.querySelector('.cleaning-transition-active')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
