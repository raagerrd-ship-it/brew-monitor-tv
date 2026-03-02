

## Plan: Synkflöde i decision-loggen

### Problem
Decision-loggen visar bara automationscykelns beslut (auto-adjust-cooling). Synkflödet (sync-rapt-data-quick) — vad som kom från RAPT, vad som bevarades, vad som skickades tillbaka — syns bara i edge function console-loggar och är osynligt i UI:t.

### Mål
Visa hela synk-pipelinen som en rak linje i loggen:
1. **RAPT → DB**: Vilken data som kom in (pill_temp, ctrl_temp, ctrl_target, hardware_target)
2. **Bevarad/Överskiven**: Om target_temp bevarades (PID/session/cooler) eller skrevs från RAPT
3. **Automation**: PID-justeringar, stall, glykol (redan finns)
4. **DB → RAPT**: Vilka justeringar som skickades (batch flush) — **markera bara denna sektion**

### Teknisk approach

#### 1. Utöka decision-loggen med synk-data (auto-adjust-cooling/index.ts)

Auto-adjust-cooling läser redan alla controllers från DB (`rapt_temp_controllers`). Den har dock inte tillgång till vad RAPT-hårdvaran rapporterade *innan* sync-rapt-data-quick skrev till DB.

**Lösning**: Lägg till en `SYNC_DATA`-loggpost per controller i `auto-adjust-cooling` som loggar det aktuella DB-tillståndet (som nu är post-sync). Lägg även till en `RAPT_SENT`-sektion runt batch flush-loggen som markerar vad som faktiskt skickades.

Logformatet per controller:
```
SYNC_DATA | Controller: X
  last_update: HH:MM:SS
  pill_temp: 8.8
  ctrl_temp: 5.6
  ctrl_target: 5.4
  profile_target: 8.0
  preserved: true/false
```

Detta finns redan delvis som `FOLLOWED_DATA`. **Ändra**: Döp om `FOLLOWED_DATA` till `SYNC_DATA`, lägg till `profile_target_temp` och `hardware_preserved`-flagga. Alla controllers ska ha samma format.

#### 2. Markera RAPT-sändningar tydligt

Lägg till en `RAPT_SEND`-step för varje controller som faktiskt skickas i batch flush, med tydlig `action`-markering. Övriga steg förblir `info`.

#### 3. Uppdatera UI:t (AutoCoolingDecisionLogs.tsx)

I den expanderade decision-log-vyn:
- `SYNC_DATA`-rader: visa som enhetlig tabell per controller
- `RAPT_SEND`-rader: markera med orange/action-badge
- Resterande info-rader: visa som idag

#### 4. Pill-comp toggle (bonus)

Redan möjligt via Settings → Automation. Inget behov av extra toggle i loggen — det finns redan.

### Filer att ändra

1. **`supabase/functions/auto-adjust-cooling/index.ts`**
   - Döp om `FOLLOWED_DATA` → `SYNC_DATA`
   - Lägg till `profile_target_temp` och `preserved`-flagga i details
   - Lägg till `RAPT_SEND`-loggposter i batch flush-sektionen

2. **`src/components/AutoCoolingDecisionLogs.tsx`**
   - Rendera `SYNC_DATA`-poster med enhetligt tabellformat
   - Markera `RAPT_SEND`-poster visuellt (orange action-badge)
   - Lägg till "Dölj synk"-toggle för att dölja SYNC_DATA-rader i loggen

### Detaljerat loggformat (alla controllers, konsekvent)

```
SYNC_DATA | info | Controller: Temp Controller Gul
  details: {
    last_update: "07:11:22",
    pill_temp: 8.8,
    ctrl_temp: 5.6,
    ctrl_target: 5.4,
    profile_target: 8.0,
    cooling_enabled: true,
    preserved: true,          // target_temp bevarades (PID/session)
    is_actively_cooling: true
  }
```

```
RAPT_SEND | action | Temp Controller Gul: 5.4°C → 4.8°C
  details: { controller_id: "...", source: "PID" }
```

