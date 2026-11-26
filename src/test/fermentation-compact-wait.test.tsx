import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FermentationSessionCompact } from '@/components/fermentation/FermentationSessionCompact';
import type { StepPhase } from '@/components/fermentation/StepPhasesList';
import type { FermentationProfileStep } from '@/types/fermentation';

// Pi:ns väntandefas: villkoret saknar värde/mål -> "Väntar på dig"-fallet.
const waitPhases: StepPhase[] = [
  {
    label: 'Vörten till 20°',
    status: 'active',
    condition: { label: 'Vörten vid 20°', value: null, target: null, unit: null },
  },
];

function renderWaitBanner() {
  return render(
    <FermentationSessionCompact
      profileName="Tysk Pils"
      status="active"
      currentStepIndex={0}
      totalSteps={7}
      stepStartedAt={new Date().toISOString()}
      targetTemp={20}
      isRamping={false}
      rampProgress={null}
      piStepPhases={waitPhases}
      piStepName="Väntar på jäst vid 20°"
      piStepCount={7}
      piStepIndex={0}
    />,
  );
}

afterEach(cleanup);

describe('TV-stegbannern medan steget väntar', () => {
  it('visar Väntar-brickan men inte dubbelraden "Väntar på dig"', () => {
    const { container } = renderWaitBanner();
    const text = container.textContent ?? '';
    expect(text).toContain('Väntar');
    expect(text).not.toContain('Väntar på dig');
  });

  it('behåller fasraden "Vörten till 20°"', () => {
    const { container } = renderWaitBanner();
    expect(container.textContent ?? '').toContain('Vörten till 20°');
  });
});

// Pi:ns delfaser i timmar — raden under badgen ska då vara fri från temperatur.
const holdPhases: StepPhase[] = [
  {
    label: 'Håller 48 h',
    status: 'active',
    condition: { label: 'Håller 48 h', value: 0.3, target: 48, unit: 'h', remaining_h: 47.7 },
  },
];

// Pi:ns delfaser i grader — temperaturen ska vara kvar i raden.
const rampPhases: StepPhase[] = [
  {
    label: 'Rampar mot 18°',
    status: 'active',
    condition: { label: 'Rampar till 18°', value: 16, target: 18, unit: '°C' },
  },
];

// Utan sluttid (t.ex. enhet %) ska värdet visas som i dag.
const percentPhases: StepPhase[] = [
  {
    label: 'Fyller på',
    status: 'active',
    condition: { label: 'Fyller på', value: 40, target: 80, unit: '%' },
  },
];

function renderPiBanner(phases: StepPhase[], step: FermentationProfileStep) {
  return render(
    <FermentationSessionCompact
      profileName="Tysk Pils"
      status="active"
      currentStepIndex={7}
      totalSteps={9}
      currentStep={step}
      stepStartedAt={new Date().toISOString()}
      stepStartTemp={16}
      targetTemp={18}
      isRamping={false}
      rampProgress={null}
      piStepPhases={phases}
      piStepName="Håller"
      piStepCount={9}
      piStepIndex={7}
      piTempTargetC={17}
    />,
  );
}

const detailRow = (container: HTMLElement) => container.querySelector('div.flex-wrap.mt-1');

describe('TV-stegbannern med Pi:ns delfaser', () => {
  it('fas i timmar visar ingen temperatur och ingen ledande avgränsare', () => {
    const step = { step_type: 'hold', target_temp: 14, duration_hours: 48 } as FermentationProfileStep;
    const { container } = renderPiBanner(holdPhases, step);
    const row = detailRow(container);
    expect(row).not.toBeNull();
    const text = row?.textContent ?? '';
    expect(text).toContain('Håller 48 h');
    expect(text).toContain('klart');
    expect(text).not.toContain('av 48 h');
    expect(text).not.toContain('°');
    expect(text.startsWith('│')).toBe(false);
  });

  it('fas i grader visar temperaturen', () => {
    const step = { step_type: 'ramp', target_temp: 18, duration_hours: null } as FermentationProfileStep;
    const { container } = renderPiBanner(rampPhases, step);
    const row = detailRow(container);
    expect(row).not.toBeNull();
    const text = row?.textContent ?? '';
    expect(text).toContain('17,0°');
    expect(text).not.toContain('│');
  });

  it('fas utan sluttid visar värdet', () => {
    const step = { step_type: 'hold', target_temp: 14, duration_hours: null } as FermentationProfileStep;
    const { container } = renderPiBanner(percentPhases, step);
    const text = detailRow(container)?.textContent ?? '';
    expect(text).toContain('40 av 80 %');
    expect(text).not.toContain('klart');
  });
});
