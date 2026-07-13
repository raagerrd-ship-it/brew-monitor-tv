# Steg 1+2+3: pid_mode-kolumn + reset av alla tre controllers (Green, Gul, Blå)

Kör som en sammanhängande sekvens. Inga övriga ändringar (mode-switch, trimI-tak, PID-formel, D-fönster, seed-logik, hold-observer förblir orörda). Step 4 (0.35°/0.20°C/h early switching) är oberoende och ingår inte här.

## Operativ sekvensering (explicit)

1. **Migration deployas först** — kolumnen `pid_mode` måste existera i DB innan någon kod som skriver eller läser den körs.
2. **Kod-deploy efter migrationen är landad** — controller-adjustments.ts (skriv) + pid-compensation-claude.ts (läs).
3. Steg 2-verifiering väntar minst en PID-cykel efter kod-deploy.
4. Steg 3 (reset) körs endast efter att Steg 2 verifierat OK.

## Steg 1 — `pid_mode`-kolumn

**Migration (deployas först, ensam):** Lägg till `pid_mode text` (nullable) på `temp_controller_history`. NULL = "pre-fix legacy". `cooling_enabled` behålls oförändrat, ingen backfill, inga index.

**Kod (deployas efter att migrationen är landad):**

- `supabase/functions/_shared/controller-adjustments.ts` — skriv `pid_mode: 'heating' | 'cooling'` i PID-loopens history-insert, härlett från vilket läge PID faktiskt kör i just den cykeln (inte från `cooling_enabled`).
- `supabase/functions/_shared/pid-compensation-claude.ts` → `learnFeedforwardDuty` — byt filter från `cooling_enabled !== wantCoolingEnabled` till `pid_mode !== mode`. Rader med `pid_mode = NULL` (pre-fix) exkluderas automatiskt av `!==`-jämförelsen mot en icke-null-sträng — önskat beteende, ingen explicit IS NOT NULL behövs.

## Steg 2 — Pre-reset verifiering

Efter kod-deploy, vänta minst en PID-cykel, kör:

```sql
SELECT recorded_at, controller_id, pid_mode, cooling_enabled, duty_pct
FROM temp_controller_history
WHERE recorded_at >= now() - interval '30 minutes'
ORDER BY recorded_at DESC LIMIT 20;
```

Bekräfta att nya rader har `pid_mode` satt (`'heating'` eller `'cooling'`, inte NULL). **Om NULL → stoppa, gå inte vidare till Steg 3.** Koden når inte insert-vägen som förväntat, undersök innan reset.

## Steg 3 — Reset av Green, Gul, Blå

Endast efter att Steg 2 verifierat OK.

**Controllers:**
- Green: `6fbbc7db-cc77-49c8-be48-4f07ebb6ff5d`
- Gul: `618b29b0-fa02-4f27-a8f1-a215f44235b3`
- Blå: `ffa62be4-d6f7-4533-83b4-57ad93c3ac01`

**SQL:**

```sql
DELETE FROM fermentation_learnings
WHERE controller_id IN (
  '6fbbc7db-cc77-49c8-be48-4f07ebb6ff5d',
  '618b29b0-fa02-4f27-a8f1-a215f44235b3',
  'ffa62be4-d6f7-4533-83b4-57ad93c3ac01'
);

UPDATE controller_learned_compensation
SET
  <alla numeriska fält> = 0,
  sensor_anchor = '{}'::jsonb,
  updated_at = now()
WHERE controller_id IN (
  '6fbbc7db-cc77-49c8-be48-4f07ebb6ff5d',
  '618b29b0-fa02-4f27-a8f1-a215f44235b3',
  'ffa62be4-d6f7-4533-83b4-57ad93c3ac01'
);
```

Exakt kolumnlista bekräftas mot schemat innan körning. `process_gain:*` och `cool_response:*` sitter som fermentation_learnings-rader under andra `parameter_name`-nycklar och deletas automatiskt av DELETE ovan — inga separata åtgärder behövs.

## Förväntat beteende efter reset (Green, aktiv)

- **ff = 5.0%** första loggraden (FEEDFORWARD_DEFAULT via fallback(null), verifierat i tre av tre kodpaths).
- **1%-risk:** om första Supabase-queryn timeoutar → `catch(() => 0)` ger 0% en cykel, sedan 5% nästa. Självläkande.
- **trimI = 0** initialt, kan bidra upp till +10% via cykler.
- **D-term inaktiv ~35 min** medan ssotHistory byggs upp till RATE_WINDOW_LOW=25 min.
- **Duty domineras av P·need** första 1–2h.
- **Physics-learner** behöver `n_amb ≥ 4` OCH `n_resp ≥ 4` i rätt läge (nu korrekt attribuerat).
- **Första `🔒 hold-ssFloor` skriver real ff** ~1h efter reset.

## Disciplincheck efter körning

Första logg-raden för Green: bekräfta `ff=5.0%` (inte `0.0%`). Om 0% → catch()-fallet inträffade, förvänta 5% nästa cykel. Om 0% kvarstår >2 cykler → verklig bugg, undersök.

## Verifiering

```sql
SELECT controller_id, COUNT(*) FROM fermentation_learnings
WHERE controller_id IN (<tre ovan>) GROUP BY 1;
-- förväntat: 0 rader

SELECT controller_id, sensor_anchor, updated_at, <numeriska fält>
FROM controller_learned_compensation
WHERE controller_id IN (<tre ovan>);
-- förväntat: alla numeriska = 0, sensor_anchor = '{}', updated_at färskt
```
