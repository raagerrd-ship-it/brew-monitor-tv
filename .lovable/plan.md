

## Plan: Ta bort Overshoot-prevention-funktionen

Togglen `overshoot_prevention_enabled` styr ingen faktisk logik i backend. Ramp-rate-limiting, settling guard och cooler-margin-learning körs alltid. Funktionen är död kod.

### Ändringar

**1. Settings-sidan** (`src/pages/Settings.tsx`)
- Ta bort Overshoot-prevention toggle (Switch + Shield-ikon)

**2. Settings-hook** (`src/hooks/use-settings-data.ts`)
- Ta bort `overshootPreventionEnabled` state, `handleOvershootPreventionChange` callback, och dess export

**3. AutomationFeatureStatus** (`src/components/AutomationFeatureStatus.tsx`)
- Ta bort block 4 (Overshoot prevention controllers-visning)
- Ta bort `overshootPreventionEnabled` från Props-interface

**4. AutoCoolingDecisionLogs** (`src/components/AutoCoolingDecisionLogs.tsx`)
- Ta bort `overshoot_prevention` från disabled-features-listan

**5. Edge functions** (cosmetic cleanup)
- `auto-adjust-cooling/index.ts`: Ta bort `overshoot_prevention` från settings-details-loggen
- `ai-automation-audit/index.ts`: Ta bort referens till `overshoot_prevention_enabled` från förbjudna-listan och context-data

Inga databas-migrationer behövs — kolumnen kan ligga kvar.

