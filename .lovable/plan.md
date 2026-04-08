
Mål

- Göra dödbandet till en håll-zon, inte en avstängnings-zon.
- Låta `ssFloor` vara den duty som faktiskt håller exakt måltemp trots termisk tröghet.
- Sluta "tappa" steady duty precis när systemet når målet.

Status: ✅ Implementerat

Ändringar gjorda

### 1. PID target-hold i `pid-compensation.ts`

- **Deadband (±0,10°C)**: Integralen konvergerar mot ssFloor via EMA. Recovery-alpha ökar vid warm-drift.
- **Target Hold (±0,10–0,25°C)**: Viktad duty istället för att nolla:
  - **Cool side** (need -0,10 till -0,25): 70% av ssFloor, holdAlpha=0,15
  - **Warm side** (need +0,10 till +0,25): 130% av ssFloor, holdAlpha=0,30 (heating) / 0,15 (cooling)
  - Heating använder snabbare alpha pga större termisk tröghet (heater → fluid → fermenter → probe)
- **Overshoot (>0,25°C)**: Aggressiv erosion (alpha 0,3–0,6) + integral-decay. ssFloor eroderas direkt i DB.
- Braking-zon: riktningsmedveten, hoppar över vid interpolerad data.

### 2. ssFloor-inlärning i `controller-adjustments.ts`

- Lärning tillåts i alla near-target-tillstånd: deadband, target-hold, target-hold-warm, mild-overshoot.
- Seeding (floor=0 eller <3 samples): EMA alpha 0,5/0,3 för gradvis uppbyggnad.
- Mild-overshoot: EMA alpha 0,4 för snabbare nedkonvergens.
- Normal deadband: direkt sättning av floor till nuvarande integral.
- Stabilitetsguard: ±20% (deadband) / ±50% (mild-overshoot) tolerans.

### 3. PWM Dithering

- Ersätter ren 10%-kvantisering med tidsstyrd alternering mellan angränsande steg.
- 10-slots cykel (50 min, baserad på `Date.now() / 300000 % 10`).
- Exempel: dutyRaw=23% → 7 cykler 20% + 3 cykler 30% = effektiv 23%.
- ssFloor lagras med full precision; dithering säkerställer korrekt medeldrift.
- Loggning: `raw=X%, dither=slot/threshold` för spårbarhet.

### 4. Skydd som behållts

- `MODE_FLOOR_BLOCK`: etablerat golv i ett läge blockerar byte till motsatt.
- Marginalskalning för kyla (coolerMarginContext).
- Bromszon: riktningsmedveten, kräver bekräftad sensordata.
- Mode-switch: kräver 3 stabila cykler + 0% duty.

Filer

- `supabase/functions/_shared/pid-compensation.ts`
- `supabase/functions/_shared/controller-adjustments.ts`

Ingen databasmigration behövdes.
