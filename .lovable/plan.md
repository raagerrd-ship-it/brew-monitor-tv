
# Temperatur-Delta: Pill vs Controller

## Bakgrund
- **Pill** (RAPT Pill): flyter pa ytan, mater yttemperatur
- **Controller** (inbyggd sensor): sitter i mitten, mater karntemperatur
- **Delta** (Pill - Controller): positiv = ytan ar varmare an mitten = aktiv jasning genererar varme som stiger uppat

## Del 1: Visa delta pa brew-kortet (TempStat)

Utoka `TempStat`-komponenten sa att nar bade pill och controller finns, visas deltat som en liten indikator under temperaturvardet.

**Visuellt:**
- Visa t.ex. `+0.8°` i gront (pill varmare) eller `-0.3°` i blatt (pill kallare)
- Liten pilikon uppat/nedat beroende pa riktning
- Inkludera delta i tooltip-texten

**Filer att andra:**
- `src/components/brew-card/TempStat.tsx` - Berakna delta och visa det visuellt

## Del 2: Smartare auto-cooling med delta-trend

Utoka `auto-adjust-cooling` edge-funktionen sa att den tar hansyn till pill_temp vs current_temp-deltat for varje foljd controller.

**Logik:**
- Hamta `pill_temp` fran den kopplade pillen (via `linked_pill_id`) for varje foljd controller
- Om `pill_temp` finns: berakna delta = pill_temp - current_temp
- Om delta ar stigande (jamfor med senaste historiken): jasningen okar i intensitet, bor kyla mer proaktivt
- Om delta ar hogt (t.ex. over 1.5C): sank kylaren extra aggressivt (dubblera `temp_reduction_degrees`)
- Logga delta-vardet i decision log for transparens

**Ny tabell for delta-historik:**
- `temp_delta_history`: `controller_id`, `pill_temp`, `controller_temp`, `delta`, `recorded_at`
- Fylls pa av `record-temp-history`-funktionen som redan kor periodiskt

**Filer att andra:**
- `supabase/functions/record-temp-history/index.ts` - Spara delta till ny tabell
- `supabase/functions/auto-adjust-cooling/index.ts` - Anvand delta-trend i beslut
- Ny databasmigration for `temp_delta_history`-tabellen

## Del 3: Varningar vid hogt delta

Nar deltat overstiger ett troskelvarde, varna anvandaren.

**Implementering:**
- Ny tabell `temp_delta_alerts`: `controller_id`, `delta`, `alert_type`, `acknowledged`, `created_at`
- I `auto-adjust-cooling`: om delta > konfigurerat troskelvarde, skapa en alert-rad
- Pa frontend: visa en varningsindikator pa TempStat nar det finns obekraftade alerts
- Anvandaren kan bekrafta/stanga alerts via klick

**Konfiguration:**
- Lagg till `delta_alert_threshold` (standard 2.0C) i `auto_cooling_settings`
- Lagg till UI i Settings for att andra troskelvarde

**Filer att andra:**
- Ny databasmigration for `temp_delta_alerts` och nytt falt i `auto_cooling_settings`
- `supabase/functions/auto-adjust-cooling/index.ts` - Generera alerts
- `src/components/brew-card/TempStat.tsx` - Visa varningsikon
- `src/pages/Settings.tsx` - Konfiguration av troskelvarde

## Teknisk sammanfattning

### Nya databastabeller
1. `temp_delta_history` - historik over pill vs controller delta
2. `temp_delta_alerts` - aktiva varningar

### Nya kolumner
- `auto_cooling_settings.delta_alert_threshold` (decimal, default 2.0)

### Andrade filer
| Fil | Andring |
|-----|---------|
| `src/components/brew-card/TempStat.tsx` | Visa delta + varningsikon |
| `supabase/functions/auto-adjust-cooling/index.ts` | Delta-baserad logik + alerts |
| `supabase/functions/record-temp-history/index.ts` | Spara delta-historik |
| `src/pages/Settings.tsx` | Delta-troskelvarde installning |

### Prioritetsordning
1. Delta-visning pa brew-kortet (snabb vinst, inget backend-arbete)
2. Delta-historik-tabell + record-temp-history
3. Auto-cooling integration med delta-trend
4. Alert-system
