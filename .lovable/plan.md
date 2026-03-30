

# Granskning: Sensorhantering i suppressionslogik

## Analys

RAPT:s interna termostat jämför **alltid** mot sin egen probe (`fc.current_temp`). PID-systemet använder `actualTemp` (pill, probe, eller fusion beroende på konfiguration).

Suppressionslogiken beräknar revert-mål med:
```typescript
const probeTemp = fc.current_temp ?? actualTemp  // rad 605, 788, 853
```

**Problemet med fallback `?? actualTemp`**: Om RAPT-proben är null men pill finns, och användaren kör pill-only-läge, så blir `probeTemp = pillTemp`. Men RAPT jämför inte mot pill — den jämför mot sin probe. Suppressionsmålet beräknas då fel.

I praktiken: RAPT-proben är alltid tillgänglig (fysisk sensor), så `fc.current_temp` är aldrig null under normal drift. Men koden bör vara explicit.

## Identifierade ställen

1. **Rad 605** (cooling revert): `const coolingProbeTemp = fc.current_temp ?? actualTemp`
2. **Rad 788** (heating revert): `const probeTemp = fc.current_temp ?? actualTemp`
3. **Rad 853** (heating suppress): `const probeTemp = fc.current_temp ?? actualTemp`

## Lösning

### 1. Explicit probe-variabel med null-guard

Ersätt alla tre ställen med tydlig logik:

```typescript
// RAPT's thermostat always compares against its own probe sensor.
// If probe is unavailable, we cannot safely calculate suppression targets.
const raptProbeTemp = fc.current_temp
```

Om `raptProbeTemp` är null → skippa suppressionslogik och logga varning, istället för att gissa med `actualTemp`.

### 2. Cooling (rad 605–617)

```typescript
const raptProbeTemp = fc.current_temp
if (raptProbeTemp == null) {
  // Cannot calculate safe revert — use actualTarget as safe neutral
  revertTarget = round1(pidEffectiveTarget)
  log('REVERT_NO_PROBE', 'fail', `${fc.name}: probe saknas, revert → ${revertTarget}° (neutral)`)
} else if (raptProbeTemp > pidEffectiveTarget + 0.3) {
  revertTarget = round1(Math.min(raptProbeTemp + 2, coolingMaxTemp))
} else if (raptProbeTemp < pidEffectiveTarget - 0.3) {
  revertTarget = round1(Math.max(raptProbeTemp - 2, coolingMinTemp))
} else {
  revertTarget = round1(pidEffectiveTarget)
}
```

### 3. Heating revert (rad 788–790)

```typescript
const raptProbeTemp = fc.current_temp
const minTemp = parseFloat(String(fc.min_target_temp ?? '-10'))
const revertTarget = raptProbeTemp != null
  ? round1(Math.max(raptProbeTemp - 2, minTemp))
  : round1(actualTarget)  // fallback: neutral (less safe but no probe data)
```

### 4. Heating suppress (rad 853–856)

```typescript
const raptProbeTemp = fc.current_temp
if (raptProbeTemp != null) {
  const suppressThreshold = rampOverrideApplied ? 0.05 : 0.3
  if (actualTemp > actualTarget + suppressThreshold && raptProbeTemp < ctrlTarget) {
    const suppressTarget = round1(Math.max(raptProbeTemp - 2, ...))
    // ... apply suppression
  }
}
// If raptProbeTemp is null, skip suppression (can't know what RAPT sees)
```

### 5. Uppdatera plan.md

Lägg till under designbeslut att suppressionslogik **alltid** baseras på `fc.current_temp` (RAPT probe), inte `actualTemp` (fusion/pill).

## Sammanfattning

Koden är funktionellt korrekt idag (proben är alltid tillgänglig), men ändringen gör den **explicit korrekt** och framtidssäker. Variabelnamnet `raptProbeTemp` dokumenterar i koden att det är RAPT:s probe som avses, inte den fusionerade temperaturen.

