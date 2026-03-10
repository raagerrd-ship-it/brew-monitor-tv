

## Plan: Utöka AI-justerbara parametrar för maximal autonomi

### Nuläge
AI-auditen kan idag justera 6 globala parametrar och 2 typer av per-controller-learnings. Det finns ytterligare ~8 parametrar i `auto_cooling_settings` och flera inlärda parametertyper i `fermentation_learnings` som AI:n borde kunna optimera.

### Nya parametrar att lägga till

**Globala (`auto_cooling_settings`) — 5 nya:**
| Parameter | Range | Max steg | Beskrivning |
|---|---|---|---|
| `overshoot_pill_threshold` | 0.1–1.0 | ±0.1 | Marginal innan pill-overshoot-guard triggas |
| `overshoot_delta_threshold` | 0.5–5.0 | ±0.5 | Delta-tröskel för overshoot-prevention |
| `pill_compensation_min_scale` | 0.05–0.5 | ±0.05 | Lägsta skalningsfaktor för PID |
| `pill_compensation_emergency_threshold` | 1.0–5.0 | ±0.5 | Nödlägeströskel för PID |
| `auto_boost_degrees` | 0.5–4.0 | ±0.5 | Standard boost-grader vid stall |
| `stall_min_attenuation` | 5–30 | ±5 | Min dämpning innan stall-detektion |
| `stall_max_attenuation` | 70–95 | ±5 | Max dämpning för stall-detektion |
| `max_diff_from_lowest` | 3.0–15.0 | ±1.0 | Max avstånd kylare går under lägsta target |

**Per-controller (`fermentation_learnings`) — 4 nya typer:**
| Parameter pattern | Range | Max steg | Beskrivning |
|---|---|---|---|
| `hold_margin:{bucket}:{load}` | 0.5–8.0 | ±1.0 | Optimal marginal under hold-steg |
| `ramp_margin:{bucket}:{load}` | 0.5–8.0 | ±1.0 | Optimal marginal under ramp-steg |
| `duty_cycle:{bucket}` | 5–95 | ±10 | Inlärd duty cycle per temperaturzon |
| `cooling_rate:{bucket}:{load}` | 0.01–2.0 | ±0.1 | Inlärd kylhastighet |

### Ändringar

**1. `supabase/functions/ai-automation-audit/index.ts`**
- Lägg till nya parametrar i `VALID_SETTINGS_PARAMS`, `MAX_STEP`, `BOUNDS`
- Utöka `VALID_LEARNING_PARAMS` whitelist med nya mönster (prefix-matching för `hold_margin:`, `ramp_margin:`, `duty_cycle:`, `cooling_rate:`)
- Uppdatera systemprompten med dokumentation för alla nya parametrar
- Inkludera nya settings-fält i `dataPayload.settings`

**2. `src/components/AiTunableParameters.tsx`**
- Hämta de nya globala fälten i select-query
- Lägg till nya sektioner: "Overshoot-skydd", "Stall-parametrar" (utökad)
- Utöka `fermentation_learnings`-filtret för att inkludera nya parametertyper
- Visa hold/ramp-marginaler och duty cycles per controller

### Filer som ändras
- `supabase/functions/ai-automation-audit/index.ts` — prompt, whitelists, bounds, data payload
- `src/components/AiTunableParameters.tsx` — utökad visning

