import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RaptControllerBar } from '@/components/DashboardHeader';
import type { TempController } from '@/types/brew';

vi.mock('@/lib/sync-settings-store', () => ({ subscribeSyncSettings: () => () => {} }));
const controller = {
  id: 'tank', controller_id: 'tank', name: 'Tank', current_temp: 20, pill_temp: 20,
  actual_temp: 20, target_temp: 20, last_update: new Date().toISOString(), linked_pill_id: 'pill',
} as TempController;
const pill = { pill_id: 'pill', name: 'Blå', color: '#3b82f6', battery_level: 80, last_update: new Date().toISOString() };
afterEach(cleanup);

describe('TV header deviation indicators', () => {
  it('hides healthy sensors and power but keeps them unchanged outside TV', () => {
    const view = render(<RaptControllerBar controllers={[controller]} pills={[pill]} isMobile={false} isTvMode onControllerClick={() => {}} />);
    expect(view.container.querySelector('.lucide-pill,.lucide-air-vent,.lucide-power,.lucide-wifi-off')).toBeNull();
    view.rerender(<RaptControllerBar controllers={[controller]} pills={[pill]} isMobile={false} onControllerClick={() => {}} />);
    expect(view.container.querySelector('.lucide-pill')).toBeTruthy();
    expect(view.container.querySelector('.lucide-air-vent')).toBeTruthy();
  });
  it('shows missing sensor connections, stale data and the off indicator', () => {
    const view = render(<RaptControllerBar controllers={[{ ...controller, linked_pill_id: null, current_temp: null }]} pills={[]} piDisabled={{ tank: true }} isMobile={false} isTvMode onControllerClick={() => {}} />);
    expect(view.container.querySelector('.lucide-pill')).toBeTruthy();
    expect(view.container.querySelector('.lucide-air-vent')).toBeTruthy();
    expect(view.getByLabelText('Avstängd')).toBeTruthy();
    expect(view.container.querySelector('.tv-tank-opacity')).toHaveStyle({ opacity: '0.5' });
    view.rerender(<RaptControllerBar controllers={[{ ...controller, last_update: null }]} pills={[pill]} isMobile={false} isTvMode onControllerClick={() => {}} />);
    expect(view.container.querySelector('.lucide-wifi-off')).toBeTruthy();
  });
});