

## Åtgärda kvarvarande buggar (Bug 2 + Bug 3)

### Bug 2: Cooling DUTY_ZERO missar maxTemp-revert

**Problem:** När mode byter från heating till cooling kan hårdvaran stå kvar vid `maxTemp` (t.ex. 25°C) från en heating-burst. Cooling DUTY_ZERO-guarden (rad 443) kollar bara `ctrlTarget < 1` och missar detta fall.

**Fix:** Utöka DUTY_ZERO-villkoret i cooling-blocket att även fånga `ctrlTarget >= maxTemp - 0.5`:

<lov-plan>

## Åtgärda kvarvarande buggar (Bug 2 + Bug 3)

### Bug 2: Cooling DUTY_ZERO missar maxTemp-revert

**Problem:** När mode byter från heating till cooling kan hårdvaran stå kvar vid `maxTemp` (t.ex. 25°C) från en heating-burst. Cooling DUTY_ZERO-guarden (rad 443) kollar bara `ctrlTarget < 1` och missar detta fall.

**Fix:** Utöka DUTY_ZERO-villkoret i cooling-blocket (rad 443) att även fånga `ctrlTarget >= maxTemp - 0.5`:

```typescript
// Rad 443 — controller-adjustments.ts
// Före:
if (ctrlTarget < 1) {

// Efter:
const maxTemp = parseFloat(String(fc.max_target_temp ?? '25'))
if (ctrlTarget < 1 || ctrlTarget >= maxTemp - 0.5) {
```

---

### Bug 3: P-correction nollställs för alla modes vid PWM burst

**Problem:** Rad 431-433 (cooling) och 520-522 (heating) nollställer `latest_p_correction` på ALLA rader i `controller_learned_compensation` för controllern, inte bara det aktiva mode:t. Kan nollställa den andra modens inlärda P-correction i onödan.

**Fix:** Lägg till `.eq('mode', ...)` filter vid P-correction reset:

```typescript
// Rad 431-433 (cooling burst) — lägg till mode-filter:
await supabase.from('controller_learned_compensation')
  .update({ latest_p_correction: 0, updated_at: new Date().toISOString() })
  .eq('controller_id', fc.controller_id)
  .eq('mode', 'cooling')

// Rad 520-522 (heating burst) — lägg till mode-filter:
await supabase.from('controller_learned_compensation')
  .update({ latest_p_correction: 0, updated_at: new Date().toISOString() })
  .eq('controller_id', fc.controller_id)
  .eq('mode', 'heating')
```

---

### Sammanfattning

| Ändring | Fil | Rad |
|---------|-----|-----|
| DUTY_ZERO fånga maxTemp-rest | `controller-adjustments.ts` | 443 |
| P-correction reset med mode-filter | `controller-adjustments.ts` | 431-433, 520-522 |

Deploya `auto-adjust-cooling` edge function efter ändringarna.

