# Kontinuerlig ΔT-normalisering med `target_temp` som ΔT-referens

Vlaudes invändning är rätt och värd att göra explicit: `ff` mäts per definition vid jämvikt (`actual ≈ target`), så `target_temp − glycol_temp` är inte bara "lika bra" som `actual − glycol` utan **fysikaliskt korrektare** för den halvan — och rensar bort brus/dödtid/EMA-fördröjning från signalen. För `Kp` är `actual` strikt sett mer korrekt vid transienter, men skillnaden är försumbar givet tankens tröghet (~3°/h vid 100% duty) och slew-cap. Använd **`target_temp − glycol_temp` överallt** — en signal, ingen brus­inblandning.

## Formel (uppdaterad)

Referens: `ΔT_ref = 10°`, clamp: `ΔT_eff = max(target_temp − glycol_temp, 3°)`.

**`process_gain:cooling`** (mäter °C-tank-förändring per %-duty per timme)

Skrivning i `learnPidCoolingRate`:
```
observed_gain    = actual_rate_°Cph / duty_fraction
normalized_gain  = observed_gain * (ΔT_ref / ΔT_eff)
→ updateLearnedParam("process_gain:cooling", normalized_gain, ...)
```

Läsning i PID-cykeln:
```
stored_gain      = getLearnedParam("process_gain:cooling")
effective_gain   = stored_gain * (ΔT_eff / ΔT_ref)
```

**`feedforward_duty:cooling`** (steady-state-duty vid hold)

Skrivning i `learnFeedforwardDuty`:
```
observed_ff      = required_duty_at_equilibrium
normalized_ff    = observed_ff * (ΔT_eff / ΔT_ref)     // vid hög ΔT normaliseras ff UPP
→ updateLearnedParam("feedforward_duty:cooling", normalized_ff, ...)
```

Läsning:
```
stored_ff        = getLearnedParam("feedforward_duty:cooling")
effective_ff     = stored_ff * (ΔT_ref / ΔT_eff)       // vid hög ΔT behövs mindre ff nu
```

Notera riktningen: `ff` skalas **motsatt** `process_gain`. Vid låg glykol (stor ΔT) räcker mindre duty för att hålla — så `effective_ff` går ner. Vid varm glykol (liten ΔT) behövs mer duty — `effective_ff` går upp.

## Kant­fall Vlaude flaggade

Om `target_temp` ändras plötsligt (manuell crash 20° bort) hoppar `ΔT_eff` direkt — men slew-cap på duty-utfallet fasar in det gradvis, så praktisk risk är låg. Värt att veta om en korrektion känns "för tidig" precis efter manuell mål­ändring; ingen skyddsåtgärd nu.

## Seed vid deploy

Nuvarande värden i `fermentation_learnings` speglar dagens genomsnittliga arbetspunkt (~ΔT=8° historiskt). Migrations­engångs­skalning:
```sql
UPDATE fermentation_learnings
   SET learned_value = learned_value * (10.0 / 8.0)    -- process_gain
 WHERE parameter_name LIKE 'process_gain:%';
UPDATE fermentation_learnings
   SET learned_value = learned_value * (8.0 / 10.0)    -- feedforward_duty
 WHERE parameter_name LIKE 'feedforward_duty:%';
```
Efter det står värdena i "ΔT_ref=10°"-referens­ram. Ingen hopp­effekt vid deploy eftersom skalningen även appliceras vid läsning samma cykel.

## Var koden ändras

- **`supabase/functions/_shared/pid-compensation-claude.ts`** (V6/Claude, primärt) — läsplats för `feedforward_duty` och `process_gain`. Wrappa `getLearnedParam`-svaren med `* (ΔT_eff/ΔT_ref)` respektive `* (ΔT_ref/ΔT_eff)` innan de går in i PID-räknaren.
- **`supabase/functions/_shared/pid-compensation.ts`** (V5) — samma sak, eftersom V5 läser `feedforward_duty:{mode}` som duty-golv. Utan skalning där kommer V5-tankar (Mjöd) gå fel efter seed-migrationen.
- **Skrivplatserna** (`learnFeedforwardDuty` och `learnPidCoolingRate` — troligen i `pid-compensation.ts` eller egna filer, kollar exakt vid bygge) — normalisera observationen innan `updateLearnedParam`.
- **Glykol-tempen** finns redan i pipeline via `cooler-management.ts` (`is_glycol_cooler=true`). Behöver bara skickas ner till compensation-lagret.
- **Migration** för seed-omskalningen — enkel `UPDATE` per parameter-prefix.

## Öppna beslut innan bygge

1. **`ΔT_ref = 10°`** — OK, eller vill du sätta ett annat referensvärde? (Påverkar bara det lagrade värdets "enhet", inte funktion.)
2. **Clamp `max(ΔT, 3°)`** — OK, eller annan gräns? Under 3° börjar glykol­flödets termiska mättnad dominera, så vidare ökning ger inte proportionell effekt.
3. **Seed-antagande "historisk ΔT ≈ 8°"** — data visar variation per tank. Alternativ: räkna faktiskt medel per controller från 14 dagar och skala varje rad individuellt. Något mer jobb, men undviker hopp för tankar med avvikande arbetspunkt.

Säg vilka du vill låsa, så bygger jag exakt det när du växlar till build-läge.
