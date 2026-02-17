
# Temperatur-Delta: Pill vs Controller

## Bakgrund
- **Pill** (RAPT Pill): flyter pa ytan, mater yttemperatur
- **Controller** (inbyggd sensor): sitter i mitten, mater karntemperatur
- **Delta** (Pill - Controller): positiv = ytan ar varmare an mitten = aktiv jasning genererar varme som stiger uppat

## Del 1: Visa delta pa brew-kortet (TempStat) ✅
Implementerat. Delta visas med pil och farg (gront/blatt) under temperaturvardet.

## Del 2: Smartare auto-cooling med delta-trend ✅
Implementerat. Delta-historik sparas, stigande delta okar kylning 1.5x, hog delta 2x.

## Del 3: Varningar vid hogt delta ✅
Implementerat. Alerts skapas vid delta over troskelvarde, konfigurerbart i Settings.

## Del 4: Jasningsstall-detektion med AI ✅
Implementerat. Detekterar nar jasningen saktar in (rate < threshold) och SG ar langt fran FG.
- Skapar alert av typ `fermentation_stall`
- Konsulterar AI (Gemini) med all bryggdata: SG-historik, delta-trend, olstil, temp
- AI rekommenderar exakt atgard: hoj/sank temp, antal grader, konfidens
- Verkstaller automatiskt om konfidens >= 50%
- Fallback till fast +X°C om AI ej tillganglig
- Nya kolumner: `auto_boost_enabled`, `auto_boost_degrees`, `stall_rate_threshold`

## Teknisk sammanfattning

### Databastabeller
1. `temp_delta_history` - historik over pill vs controller delta
2. `temp_delta_alerts` - aktiva varningar (inkl `fermentation_stall` typ)

### Edge Functions
- `ai-fermentation-advisor` - AI-driven stallanalys med tool-calling

### Kolumner i auto_cooling_settings
- `delta_alert_threshold` (decimal, default 2.0)
- `auto_boost_enabled` (boolean, default false)
- `auto_boost_degrees` (numeric, default 1.0)
- `stall_rate_threshold` (numeric, default 0.001)

### Andrade filer
| Fil | Andring |
|-----|---------|
| `src/components/brew-card/TempStat.tsx` | Visa delta + varningsikon |
| `supabase/functions/auto-adjust-cooling/index.ts` | Delta-logik + stall-detektion + auto-boost |
| `supabase/functions/record-temp-history/index.ts` | Spara delta-historik |
| `src/pages/Settings.tsx` | Delta-troskelvarde + auto-boost installningar |
