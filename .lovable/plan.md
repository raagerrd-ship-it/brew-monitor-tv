## Problem

Idag finns `deadbandGainScale` i `pid-compensation.ts` som skalar duty-golvet uppåt när glykolen är varmare än referens (svagare kylning → mer duty). Men den vägrar uttryckligen att skala nedåt:

```ts
// Never scale DOWN — ssFloor is already learned at real conditions
deadbandGainScale = Math.max(1.0, Math.min(2.0, learnedMargin / actualMargin))
```

Konsekvens: när glykolen är **kallare** än lärd referens (t.ex. lärd marginal 5°C men faktisk marginal 8°C → kylvatten ~3°C kallare än modellen antar) får tanken samma duty% som vid normalfallet, och **överkyler**. Det är detta du ser nu.

## Lösning

Tillåt symmetrisk skalning: `gainScale = clamp(learnedMargin / actualMargin, 0.6, 1.8)`. När faktisk marginal är större (kallare glykol) blir kvoten <1 och duty skalas ned proportionellt — samma kyleffekt levereras med mindre duty.

### Varför detta inte korrumperar lärningen
- `ssFloor`-lärningen sker via separata EMA-uppdateringar baserat på faktiskt uppnådd hold, inte på den skalade duty-utdatan.
- Vi rör inte `ssFloorRaw` i DB. Endast den **utskickade** duty-cykeln påverkas.
- Asymmetriskt fönster: tillåt mer uppskalning (1.8×) än nedskalning (0.6×) eftersom överkylning är mindre farlig än underkylning, men nedskalning fortfarande aktiv.

### Var skalningen appliceras
Idag triggar `margin-scale`-loggen i tre grenar (deadband, target-hold, ytterligare en). Skalningen appliceras redan via `ssFloor = ssFloorRaw * deadbandGainScale` så ändringen är minimal — bara klampgränsen.

## Tekniska ändringar

**Fil:** `supabase/functions/_shared/pid-compensation.ts`

1. Rad ~215–223: Ändra clamp från `Math.max(1.0, …)` till `Math.max(0.6, …)`. Behåll övre tak 1.8 (sänkt från 2.0 för symmetri runt 1.0 i log-space).
2. Uppdatera kommentaren ovanför så den beskriver bidirektionell skalning.
3. Logga `margin-scale=0.75` etc precis som idag (befintliga `constraints.push` fungerar redan).

**Inget annat rörs.** Cooler-management, lärda värden, hysteres-cap, ramp-logik är orörda.

## Verifiering

1. Deploya `run-automation` + delade moduler.
2. Kolla nästa auto-cooling-decision-log: när `actualMargin > learnedMargin` ska `margin-scale` < 1.0 visas och uträknad duty% vara lägre än ssFloorRaw.
3. Observera över några cykler att hold-temperaturen inte driver undertarget mer än hysteresen.

## Memory-uppdatering

Uppdatera `mem://logic/automation/marginal-aware-duty-scaling` så den beskriver bidirektionell skalning (0.6×–1.8×) istället för "endast upp".
