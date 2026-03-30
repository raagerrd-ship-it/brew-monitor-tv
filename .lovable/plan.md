


# Temperaturinterpolering mellan RAPT-synkningar

## Status: ✅ Implementerad

## Problem
RAPT-sensorn synkar var 15:e minut, men PID:n kör var 5:e minut. 2 av 3 PID-cykler använder gammal temperaturdata.

## Lösning
Interpolera `actualTemp` mellan synkningar med inlärd termisk hastighet, duty cycle och tid sedan senaste synk. Passeras som `interpolatedTemp` till PID-beräkningen.

### Säkerhetsregler
- Minst 3 minuter stale innan interpolering
- Minst 3 samples av thermal rate krävs
- Clampa mot target (aldrig förbi mål)
- Duty-skalning (30% duty = 30% av full hastighet)
- Vid 0% duty: ingen interpolering
- Loggas som TEMP_INTERPOLATED
