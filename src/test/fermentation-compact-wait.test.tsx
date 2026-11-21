import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FermentationSessionCompact } from '@/components/fermentation/FermentationSessionCompact';
import type { StepPhase } from '@/components/fermentation/StepPhasesList';

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
