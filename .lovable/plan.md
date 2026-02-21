

# Riktningsmedveten temperaturramping

## Problem

Nuvarande ramp-logik anvander alltid `pill_temp ?? current_temp` for att avgora om malet ar natt. Detta kan leda till overshoot:

- **Ramp upp**: Proben varmer sig snabbare an olet (pill). Om vi gar efter proben nar proben malet innan olet hunnit dit, och varmen fortsatter att "sippra" in i olet.
- **Ramp ner**: Proben kyls snabbare an olet. Om vi gar efter pill sa har proben redan kylts langt under malet innan pill-sensorn reagerar.

## Losning

Andra ramp-logiken i `process-fermentation-profiles/index.ts` sa att riktningen bestammer vilken sensor som anvands:

### Regler

| Riktning | Sensor under ramp | Sensor for "natt malet" | Darefter |
|----------|-------------------|------------------------|----------|
| Upp (target > start) | pill_temp | pill_temp inom 0.3C av malet | Pill-kompensation |
| Ner (target < start) | current_temp (probe) | current_temp inom 0.3C av malet | Pill-kompensation |

### Paverkar tva stallen i ramp-logiken

**1. Linjar ramp (rad ~452-469)**

Nuvarande kod:
```typescript
const rampCheckTemp = controller.pill_temp ?? controller.current_temp
const tempReached = rampCheckTemp !== null && 
  Math.abs(rampCheckTemp - currentStep.target_temp) <= 0.3
```

Ny kod:
```typescript
const rampingUp = currentStep.target_temp > startTemp
const rampCheckTemp = rampingUp
  ? (controller.pill_temp ?? controller.current_temp)   // Upp: pill
  : (controller.current_temp ?? controller.pill_temp)   // Ner: probe
const tempReached = rampCheckTemp !== null && 
  Math.abs(rampCheckTemp - currentStep.target_temp) <= 0.3
```

**2. Omedelbar ramp / immediate (rad ~415-422)**

Samma princip - bestam riktning fran `session.step_start_temp` (eller controller.target_temp fore andring) vs `currentStep.target_temp`:

```typescript
const immStartTemp = session.step_start_temp ?? controller.target_temp ?? currentStep.target_temp
const immRampingUp = currentStep.target_temp > immStartTemp
const immRampCheckTemp = immRampingUp
  ? (controller.pill_temp ?? controller.current_temp)
  : (controller.current_temp ?? controller.pill_temp)
```

### Fil som andras

- `supabase/functions/process-fermentation-profiles/index.ts` - tva stallen i `case 'ramp'`-blocket

Ingen databasandring behovs. Pill-kompensation tar over automatiskt i nasta steg (hold) efter att rampen ar klar.

