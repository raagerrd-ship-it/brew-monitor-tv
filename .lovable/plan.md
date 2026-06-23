## Granskning: V4 PID (pid-compensation.ts) mot historik

### Vad är solitt
- **SSOT-regulering korrekt**: PI körs direkt på `actualTemp` (bulk-probe). `actualTarget` skickas tillbaka orört som `ctrlTargetPid` — `profile_target_temp` rörs inte. Bra mot SSOT-regeln.
- **Slow-PI-värden rimliga för dödtid**: Kp=0.20, Ki=0.30/h, Imax=0.35, dödband ±0.10°C. Stämmer med BrewPi/Inkbird-praxis för 60 L massa med 15 min probe-latens.
- **Pill korrekt utanför PI-felet**: bara top-cap (+0.7°C → ≥12% duty) och bottom-stop (−0.7°C → 0% + I-bleed). Matchar "pill måste vara med, men inte i fusion".
- **Min-off 5 min för kyla**: skyddar kompressor/glykolmix. Bokföringen via `lastZeroDutyAt` är korrekt (verifierat: dutyPct beräknas EFTER min-off-blocket, så state speglar verkligen utskickad duty).
- **Peak-detect 0.85×/1.15× med 0.4–2.5 clamp**: säker självtuning, kommer konvergera ~2 dygn.
- **ssFloor + margin-scale 0.6–1.8×** bevaras → kall-glykol drar ned duty proaktivt. Rör inte `ssFloorRaw` i DB.
- **Past-target-coast + overshoot-bleed (0.85×)** dämpar windup vid undershoot.

### Konkreta risker (måste fixas innan vi kan lova ±0.10°C hold)

1. **dt hårdkodad till 1 min — extra triggers över-integrerar.**
   `nextI += KiPerHour * need / 60` antar exakt 1 cykel/min. Men `auto-adjust-cooling` triggas av tre källor:
   - cron `* * * * *` (1 min)
   - RAPT-update trigger (var 15 min, drar in extra cykel direkt efter cron)
   - `ingest-pill-ble` (när BLE-paket landar)
   
   En 15-min RAPT-burst kan ge 2 cykler inom samma minut → dubbel integration. **Fix:** byt till `dt = clamp((now − lastSsotAt)/60000, 0.25, 5.0)` minuter; använd `KiPerHour * need * dt/60`. Använder redan `lastSsotAt` i V4PidState.

2. **Mode-flip mjuk reset blandar mode-integraler.**
   Vid cool→heat flip: `integral = |need|>0.5 ? 0 : integral*0.5`. Men cooling-I och heating-I har motsatta semantiska riktningar (båda är ≥0 men driver olika hårdvara). Att behålla halva cooling-I som heating-I ger en falsk varmstart. **Fix:** hård `integral = 0` på varje mode-flip (`lastMode !== mode`). Mode-switching-logiken ute i caller har redan 3-stable-cykler-guard, så flip-flop är inte ett bekymmer.

3. **Pill top-cap för svag i sommarvärme.** 12% duty vid pill +0.7°C kan inte kyla bort en varm topp om ambient är 25°C. **Fix:** gör capen progressiv:
   ```
   excess = pill − target
   if excess > 0.7: floor = clamp(0.12 + (excess − 0.7) * 0.25, 0.12, 0.40)
   ```
   Vid +1.5°C topp → 32% duty. Behåller "saktare" karaktär men respekterar fysik.

4. **Bottom-stop nollställer för svagt I.** `nextI *= 0.5` när pill < target − 0.7. Om systemet är i kraftig undershoot (kall glykol slår igenom till pill), halv I = vi kommer behöva bygga upp samma I igen → svängningar. **Fix:** `nextI = 0` när bottom-stop triggar. Den efterföljande cykeln startar rent.

### Småsaker (rör vi ej nu — dokumentera bara)
- `inDeadband` använder konstanten `COOL.Deadband` även för värme. Funktionellt rätt (±0.10°C för båda), men namnet vilseledande. Lämna.
- `deadbandGainScale`-variabeln gäller `uFf`, inte dödband. Namn confusing. Lämna.
- Heating har varken min-on/off eller peak-detect. För Mjöd/Skogens Sus är heating sällsynt (ambient ofta varmare än setpoint) — riskerar inte stabilitet.

### Verdikt
**Med fix 1–4: ja, kärlen kommer hålla ±0.10–0.15°C efter ~2 dygns självtuning.**
**Som koden står nu: ja men ±0.20–0.30°C med ojämn cykling, särskilt direkt efter RAPT-bursts.** Fix #1 är den enda som påverkar dagligt beteende; #2–4 är edge-case-härdning.

### Implementationsplan (4 små edits i `pid-compensation.ts`)

```text
1. dt från lastSsotAt        → integration använder verklig minuter
   verify: log "dt=2.3m" syns i bursts efter RAPT
2. Hård integral=0 vid mode-flip
   verify: log "mode-reset(hard)" + I=0.000 vid första flip
3. Progressiv pill-top-cap
   verify: vid pill=target+1.5 → duty ≥ 0.32, constraint "pill-top-cap(1.50→32%)"
4. Bottom-stop nollställer I
   verify: efter bottom-stop, nästa cykel börjar med I=0.000
```

Inga ändringar i `auto-adjust-cooling`, PWM, plug, mode-switching eller DB-schema. Backwards-compat på V4PidState (alla fält redan finns).

Vill du att jag implementerar alla fyra, eller bara fix #1 (störst impact)?
