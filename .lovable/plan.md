

## Kvantisera PWM duty cycle till 1-minuts-steg

### Bakgrund
`pg_cron` kör varje minut. En 5-minuters cykel (300s) ger exakt 5 möjliga ON-tider: 60s, 120s, 180s, 240s, 300s — dvs **20%, 40%, 60%, 80%, 100%**. Plus 0% (ingen burst). Systemet måste veta detta för att beräkna korrekt burst-tid.

### Ändringar

#### 1. Backend: Kvantisera i `controller-adjustments.ts`
Rad 276-278 — snäpp `pwmDutyPct` till närmaste 20%-steg och beräkna `pwmDutySeconds` som multipel av 60s:

```typescript
// Snap to 1-minute resolution: 0, 20, 40, 60, 80, 100
pwmDutyPct = Math.round(dutyParam.value * 5) * 20
pwmDutySeconds = (pwmDutyPct / 100) * 300  // 60, 120, 180, 240, 300
```

Uppdatera gränsvillkoret (rad 273) — `value > 0.05` blir `value >= 0.1` (under 20% = 0%), och `value < 0.60` kan höjas till `< 0.90` (max 80% steg, eller behåll 100% som möjligt).

#### 2. UI: `LearnedDutyCycle.tsx` — visa kvantiserade steg
- Visa duty som kvantiserat 20%-steg istället för rå procent
- Visa burst-tid som exakta minuter (1m, 2m, 3m, 4m, 5m) istället för sekunder
- Lägg till en 5-segment visuell bar (tom/fylld) som visar aktivt steg
- Uppdatera fotnoten: *"PWM kvantiseras i 1-minuts steg (pg_cron): 0%, 20%, 40%, 60%, 80%, 100%"*

#### 3. UI: `AiTunableParameters.tsx` — uppdatera bounds-text
Ändra duty cycle bounds-texten från `5–95` till `0–100 (steg 20%)` så det är tydligt att bara dessa steg är möjliga.

### Filer
- `supabase/functions/_shared/controller-adjustments.ts` — kvantisera duty + burst-tid
- `src/components/LearnedDutyCycle.tsx` — visuell steg-bar + minuter
- `src/components/AiTunableParameters.tsx` — bounds-text

