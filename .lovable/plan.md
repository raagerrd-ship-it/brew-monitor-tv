

# Fix: Pill-kompensation under ramp - konflikter och logikfel

## Identifierade problem

### 1. Ramp och pill-komp skriver over varandras target
Under linjar ramp satter koden forst ett mellanmal (rad 449-460), sedan skriver pill-komp over det (rad 470-477). Nasta cykel skriver rampen over pill-komp igen. Resultat: oscillation.

### 2. Fel referenstemperatur for pill-komp under ramp
`applyPillCompensation(currentStep.target_temp)` anvander slutmalet som referens. Under en pagaende ramp borde referensen vara det aktuella mellanmalet, inte sluttemperaturen.

### 3. tempReached vid ramp ner ar verkningslos
Vid ramp ner checkas probe-temp mot slutmalet. Men rampen har inte satt slutmalet pa controllern annu - sa proben kan inte na dit. Pill-komp triggar aldrig.

## Losning

Andra logiken i linjar ramp (rad 434-492) till:

1. **Om tempReached ar sant: SLUTA rampa, anvand bara pill-komp**
   - Skippa mellanmals-berakningen
   - Applicera pill-komp med slutmalet som referens (korrekt, for nu AR vi vid slutmalet)

2. **Om tempReached ar falskt och rampen pagar: applicera pill-komp mot mellanmalet**
   - Under ramp upp: anvand pill-komp relativt det beraknade mellanmalet (inte slutmalet)
   - Under ramp ner: samma princip

3. **Omedelbar ramp: behovs ingen andring** - dar satter vi slutmalet direkt, sa pill-komp mot slutmalet ar korrekt

### Ny logik for linjar ramp (pseudokod)

```text
startTemp = session.step_start_temp
newTarget = calculateRampTemp(start, end, duration, elapsed)

if (tempReached):
    // Temperaturen har natt slutmalet - sluta rampa
    // Satt controllern till slutmalet om den inte redan ar dar
    // Applicera pill-komp mot slutmalet
    applyPillCompensation(currentStep.target_temp)
    
    if (timeComplete):
        stepCompleted = true
else:
    // Fortfarande rampar - satt mellanmal
    setTemp(newTarget)
    
    // Applicera pill-komp mot mellanmalet (inte slutmalet)
    if (pillCompEnabled):
        applyPillCompensation(newTarget)  // <-- mellanmal, inte slutmal
```

### Fil som andras

- `supabase/functions/process-fermentation-profiles/index.ts` - omstrukturera rad 434-492 (linjar ramp-blocket)

### Vad som INTE andras

- Omedelbar ramp (rad 402-432) - fungerar korrekt, dar satter vi slutmalet direkt
- Riktningsmedveten sensorval (pill/probe) - behalles som det ar
- Hold-steg, wait-steg etc - oforandrade

