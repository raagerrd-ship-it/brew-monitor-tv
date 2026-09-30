# Bryggdagskort på TV:n

Under bryggdagen visas ett eget kort bredvid ölkorten med det steg som pågår nu i Brew Master Dashboard och vad som ska tillsättas. Du bockar av i mobilen (i Brew Master Dashboard) och TV:n följer med direkt. Kortet försvinner när bryggdagen är klar.

## Så ser flödet ut

```text
Brew Master Dashboard (mobil)  --(brew-day, vid varje stegbyte/avbockning)-->  Molnet  --realtid-->  TV
                                --(brew-day, clear vid klar/avbryt)-------->
```

Timern fortsätter gå som i dag (via Öldesignern). Bryggdagskortet går i en egen, direkt väg till den här appen – samma mönster och samma hemliga nyckel som när bryggder skickas till Pi-kön. Ingen ändring behövs i Öldesignern.

## Kortet

- Rubrik: receptnamn + nuvarande steg (t.ex. "Kok · 45 min kvar", "Mäsk 66 °C").
- Lista för steget: tillsatser med mängd och tidpunkt (t.ex. "Citra 30 g · 15 min"), med bock på det som är tillsatt. Nästa tillsats markeras.
- Glider in/ut som timern (bara transform/opacity), ölkorten ändrar bredd i ett steg på TV (samma regel som för timern).
- På mobilen blir det ett extra kort i karusellen.

## Två delar

1. **Här (den här appen):** ta emot, lagra, visa.
2. **I Brew Master Dashboard:** skicka steget och avbockningarna. Det görs i det projektet efteråt – jag skriver exakt vad som ska läggas in.

## Teknisk sammanfattning

- Ny tabell `brew_day_session` (singleton): `recipe_name`, `step_id`, `step_kind`, `step_title`, `target_temp_c` (null = okänt), `items jsonb` (`[{id, name, amount, unit, at_min, checked}]`), `updated_at`, `active boolean`. GRANT: select till anon/authenticated (TV läser med device key via befintlig väg), all till service_role. RLS: läsning öppen, skrivning bara service_role. Läggs i realtime-publikationen.
- Ny edge function `receive-brew-day`: auth med `x-brew-secret` (befintligt `BREW_INGEST_SECRET`), body `{ active, recipe_name, step, items }` eller `{ active:false }`. Idempotent upsert på singleton-raden. Rör inte `receive-brew`, `pi-control`, cron.
- Ny komponent `src/components/brew-card/BrewDayCard.tsx` + hook `use-brew-day.ts` (egen realtidsprenumeration, self-contained enligt befintligt mönster). `BrewingDashboard.tsx` lägger kortet sist i griden/karusellen när `active`.
- Säkerhetsnät: kortet döljs om `updated_at` är äldre än 12 h.
- Brew Master Dashboard: anrop från `brew-steps`/wizard vid stegbyte och vid avbockning (items byggs från receptets `HopAddition` m.m.), samt `active:false` vid klar.
