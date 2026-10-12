import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { BrewingDashboard } from '@/components/BrewingDashboard';

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
vi.mock('@/components/TimerFooter', () => ({ TimerFooter: ({ slidePhase }: any) => <output data-testid="phase">{slidePhase ?? 'null'}</output> }));
vi.mock('@/components/brew-card/BrewDayCard', () => ({ BrewDayCard: ({ transitionActive }: any) => <output data-testid="transition">{String(transitionActive)}</output> }));
vi.mock('@/components/brew-card/BrewCard', () => ({ BrewCard: () => null }));
vi.mock('@/components/brew-card/BrewCardSkeleton', () => ({ BrewCardSkeleton: () => null }));
vi.mock('@/components/RaptControllerDialog', () => ({ RaptControllerDialog: () => null }));
vi.mock('@/components/DashboardBackground', () => ({ DashboardBackground: () => null }));
vi.mock('@/components/DashboardAlertOverlay', () => ({ DashboardAlertOverlay: () => null }));
vi.mock('@/components/CleaningChecklistOverlay', () => ({ CleaningChecklistOverlay: () => null }));

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); state.day = null; });

describe('brew day phase watchdog', () => {
  it('finishes entry and exit without any transitionend events', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    state.day = { recipe_name: 'Mätbrygd', items: [] };
    const view = render(<BrewingDashboard />);
    const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
    const phase = (value: string) => expect(screen.getByTestId('phase').textContent).toBe(value);
    phase('prepare');
    advance(700); phase('row');
    advance(2699); phase('row');
    advance(301); phase('card');
    advance(2900); phase('card');
    advance(400); phase('footer');
    advance(3500); phase('footer');
    advance(200); phase('null');
    expect(screen.getByTestId('transition').textContent).toBe('false');
    expect(view.container.querySelector('.cleaning-transition-active')).toBeNull();

    state.day = null;
    view.rerender(<BrewingDashboard />);
    phase('prepare');
    advance(700); phase('footer');
    advance(3500); phase('footer');
    advance(200); phase('card');
    advance(2700); phase('card');
    advance(200); phase('row');
    advance(2700); phase('row');
    advance(300); phase('null');
    expect(screen.queryByTestId('transition')).toBeNull();
    expect(view.container.querySelector('.cleaning-transition-active')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});