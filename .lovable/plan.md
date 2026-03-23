

## Fix: Bevara PI-integral under PWM-bursts

### Problem
PID-beräkningen körs varje cykel och ackumulerar integralen korrekt (`persistPidState` i `pid-compensation.ts`). Men direkt efter sparas integralen till 0 av PWM-blocket (rad 417-422 i `controller-adjustments.ts`). Nästa cykel startar PID från 0 igen — integralen hinner aldrig byggas upp.

Flödet idag per cykel:
```text
PID beräknar → integral 0.00 → 0.02 → sparas ✓
PWM aktiveras → integral 0.02 → 0.00 → sparas ✗
Nästa cykel: PID startar från 0.00 igen
```

### Fix

**Fil: `supabase/functions/_shared/controller-adjustments.ts`** (rad 417-422)

Ändra PWM-reset till att bara nollställa P-korrektionen (som är meningslös under en 0°C-burst), men bevara `accumulated_integral`:

```typescript
// P-term är meningslös under PWM-burst (proben kyls artificiellt av 0°C).
// Integralen representerar systemets inlärda offset och MÅSTE bevaras,
// annars kan PID aldrig kompensera för systematisk underskjutning.
await supabase.from('controller_learned_compensation')
  .update({ latest_p_correction: 0, updated_at: new Date().toISOString() })
  .eq('controller_id', fc.controller_id)
log('PID_PARTIAL_RESET', 'info', `${fc.name}: P-term nollställd inför PWM (integral bevarad)`)
```

### Förväntat resultat

Integralen växer gradvis över PWM-cykler (0.02 → 0.04 → 0.06...), vilket höjer hårdvarumålet tills 0.2°C-offseten kompenseras. Duty cycle justeras automatiskt när jämvikten hittas.

