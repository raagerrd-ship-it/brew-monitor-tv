/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { DashboardFooterProvider, useDashboardFooter } from '@/contexts/DashboardFooterContext';
import { DashboardAlertProvider, useDashboardAlert } from '@/contexts/DashboardAlertContext';
import { DashboardAlertOverlay } from '@/components/DashboardAlertOverlay';

// Helper to test context values
function FooterConsumer() {
  const { footerHeight, footerContent } = useDashboardFooter();
  return (
    <div>
      <span data-testid="height">{footerHeight}</span>
      <span data-testid="has-content">{footerContent ? 'yes' : 'no'}</span>
    </div>
  );
}

function FooterProducer({ height, content }: { height: number; content?: React.ReactNode }) {
  const { setFooterSlot, clearFooterSlot } = useDashboardFooter();
  return (
    <div>
      <button onClick={() => setFooterSlot(content || <span>footer</span>, height)}>set</button>
      <button onClick={() => clearFooterSlot()}>clear</button>
    </div>
  );
}

describe('DashboardFooterContext', () => {
  it('defaults to height 0 and no content', () => {
    render(
      <DashboardFooterProvider>
        <FooterConsumer />
      </DashboardFooterProvider>
    );
    expect(screen.getByTestId('height').textContent).toBe('0');
    expect(screen.getByTestId('has-content').textContent).toBe('no');
  });

  it('updates height and content when setFooterSlot is called', () => {
    render(
      <DashboardFooterProvider>
        <FooterProducer height={90} />
        <FooterConsumer />
      </DashboardFooterProvider>
    );
    act(() => screen.getByText('set').click());
    expect(screen.getByTestId('height').textContent).toBe('90');
    expect(screen.getByTestId('has-content').textContent).toBe('yes');
  });

  it('resets when clearFooterSlot is called', () => {
    render(
      <DashboardFooterProvider>
        <FooterProducer height={90} />
        <FooterConsumer />
      </DashboardFooterProvider>
    );
    act(() => screen.getByText('set').click());
    act(() => screen.getByText('clear').click());
    expect(screen.getByTestId('height').textContent).toBe('0');
    expect(screen.getByTestId('has-content').textContent).toBe('no');
  });
});

// Alert context tests
function AlertProducer() {
  const { showAlert, dismissAlert } = useDashboardAlert();
  return (
    <div>
      <button onClick={() => showAlert({ id: 'test', content: <span>Alert!</span>, autoDismissMs: null })}>show</button>
      <button onClick={() => showAlert({ id: 'auto', content: <span>Auto!</span>, autoDismissMs: 500 })}>show-auto</button>
      <button onClick={() => dismissAlert('test')}>dismiss</button>
      <button onClick={() => dismissAlert('wrong-id')}>dismiss-wrong</button>
    </div>
  );
}

describe('DashboardAlertContext', () => {
  it('shows and renders alert content via overlay', () => {
    render(
      <DashboardAlertProvider>
        <AlertProducer />
        <DashboardAlertOverlay />
      </DashboardAlertProvider>
    );
    expect(screen.queryByText('Alert!')).toBeNull();
    act(() => screen.getByText('show').click());
    expect(screen.getByText('Alert!')).toBeInTheDocument();
  });

  it('dismisses alert by matching id', () => {
    render(
      <DashboardAlertProvider>
        <AlertProducer />
        <DashboardAlertOverlay />
      </DashboardAlertProvider>
    );
    act(() => screen.getByText('show').click());
    expect(screen.getByText('Alert!')).toBeInTheDocument();
    act(() => screen.getByText('dismiss').click());
    expect(screen.queryByText('Alert!')).toBeNull();
  });

  it('does not dismiss alert with wrong id', () => {
    render(
      <DashboardAlertProvider>
        <AlertProducer />
        <DashboardAlertOverlay />
      </DashboardAlertProvider>
    );
    act(() => screen.getByText('show').click());
    act(() => screen.getByText('dismiss-wrong').click());
    expect(screen.getByText('Alert!')).toBeInTheDocument();
  });

  it('auto-dismisses after specified time', async () => {
    vi.useFakeTimers();
    render(
      <DashboardAlertProvider>
        <AlertProducer />
        <DashboardAlertOverlay />
      </DashboardAlertProvider>
    );
    act(() => screen.getByText('show-auto').click());
    expect(screen.getByText('Auto!')).toBeInTheDocument();
    
    act(() => vi.advanceTimersByTime(600));
    expect(screen.queryByText('Auto!')).toBeNull();
    vi.useRealTimers();
  });
});
