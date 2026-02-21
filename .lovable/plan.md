
## Fix: "Nu:" visar fel steg i timer-footern

### Problem
"Nu:" visar alltid "Proteinrast: 52°C" trots att det steget ar passerat for lange sedan. Orsaken ar att logiken letar efter forsta milestone som ar `triggered` men inte `acknowledged`. Proteinrast triggades forst men kvitterades aldrig (den behover inte kvitteras), sa den "fastnar" som aktivt steg.

### Losning
Andra logiken for att valja "Nu:"-steget. Istallet for att prioritera okvitterade milestones, valj det senast triggade steget baserat pa tid. Det senast triggade steget ar det med lagst `time`-varde bland alla triggade milestones (hogre `time` = tidigare i processen).

### Tekniska detaljer

**`src/components/TimerFooter.tsx`** - Rad ~162-166

Nuvarande logik:
```typescript
const activeMilestone = timer.milestones.find(m => m.triggered && !m.acknowledged) || null;
const currentMilestone = activeMilestone || timer.milestones
  .filter(m => m.triggered && m.acknowledged)
  .sort((a, b) => a.time - b.time)[0] || null;
```

Ny logik:
```typescript
const currentMilestone = timer.milestones
  .filter(m => m.triggered === true || (m.triggered !== false && m.time >= timer.remainingSeconds))
  .sort((a, b) => a.time - b.time)[0] || null;
```

Detta valjer det milestone med lagst `time` bland alla triggade, vilket ar det senast passerade steget (= det steg vi ar "i" just nu).

### Resultat
- Med ~2800s kvar visas "Nu: Sackarifikation: 67°C i 60 min" (korrekt)
- "Nasta: Mashout: 78°C i 10 min" (redan korrekt)
- Nar Mashout triggas byts "Nu:" till Mashout
