import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
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
vi.mock('@/components/brew-card/BrewDayCard', () => ({ BrewDayCard: () => null }));
vi.mock('@/components/brew-card/BrewCard', () => ({ BrewCard: () => null }));
vi.mock('@/components/brew-card/BrewCardSkeleton', () => ({ BrewCardSkeleton: () => null }));
vi.mock('@/components/RaptControllerDialog', () => ({ RaptControllerDialog: () => null }));
vi.mock('@/components/DashboardBackground', () => ({ DashboardBackground: () => null }));
vi.mock('@/components/DashboardAlertOverlay', () => ({ DashboardAlertOverlay: () => null }));
vi.mock('@/components/CleaningChecklistOverlay', () => ({ CleaningChecklistOverlay: () => null }));

// Stands in for the real footer: the dashboard moves this element through slideRef.
vi.mock('@/components/TimerFooter', () => ({
  TimerFooter: ({ slideRef }: any) => (
    <div ref={slideRef} data-testid="footer" data-footer-visible={state.day ? '1' : '0'} />
  ),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  state.day = null;
});

describe('timer footer slide out', () => {
  it('fades in on entry and slides out without changing opacity', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    state.day = { recipe_name: 'Mätbrygd', items: [] };
    const view = render(<BrewingDashboard />);
    const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
    const footer = () => view.container.querySelector('[data-testid="footer"]') as HTMLElement;

    // Entry: the footer comes last and fades in while it rises.
    advance(700); advance(2700); advance(300); advance(2900); advance(400);
    expect(footer().style.transform).toBe('translateY(0)');
    expect(footer().style.opacity).toBe('1');

    // Exit: the footer slides down first and must stay fully opaque on the way out.
    state.day = null;
    view.rerender(<BrewingDashboard />);
    advance(700);
    expect(footer().style.transform).toBe('translateY(100%)');
    expect(footer().style.opacity).toBe('1');
    expect(footer().style.transition).not.toContain('opacity');
    advance(3500);
  });
});
