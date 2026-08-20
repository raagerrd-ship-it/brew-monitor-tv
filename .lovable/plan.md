# Brygg från Brew Master Dashboard rakt in i Pi-kön

## Så ser flödet ut i dag

```text
Brew Master Dashboard  --(receive-brew)-->  Molnet  --(pi-control)-->  Pi:n
                                              |                         |
                                        pi_pending_at satt        du bekräftar tank
```

`receive-brew` sätter redan `pi_pending_at` på bryggen när den tas emot, och `pi-control`
listar den under `pending_brews`. Ingen knapptryckning i den här appen behövs — Pi:n hämtar
kön och du väljer/bekräftar tank där. Det manuella steget som finns kvar i appen
("Skicka till Jäscontroller") är bara en reserv om något gått fel.

Det som faktiskt saknas är att Brew Master Dashboard anropar `receive-brew` när du startar
en jäsning. Två brygg (6 aug) kom in den vägen men arkiverades automatiskt innan de
kvitterades.

## Vad som byggs här

1. **Kön ska överleva.** `pi-control` visar bara brygg som är max 24 h gamla, och
   städjobbet `archive_empty_brew_drafts` arkiverar okvitterade brygg efter 24 h.
   Ändras till 7 dygn för kön, och städjobbet hoppar över brygg med `pi_pending_at` satt.
2. **Notis när en brygg landar.** `receive-brew` lägger en rad i `pending_notifications`
   ("Ny brygg från Dashboard väntar på tank") så du ser att den kommit fram.
3. **Tydligare i BrewManagement.** Brygg i kön får en egen "Väntar på Jäscontroller"-sektion
   överst med tidpunkt, plus möjlighet att ta bort från kön.

Tankvalet ligger kvar helt på Pi:n — molnet gissar aldrig tank och skickar aldrig
`linked_controller_id` vid ingest.

## Sidan i Brew Master Dashboard

Där behöver ett anrop läggas in när en jäsning startas:

`POST https://<projekt>.supabase.co/functions/v1/receive-brew`
med header `x-brew-secret` (samma värde som `BREW_INGEST_SECRET` här) och body:

```json
{
  "source_id": "<bryggens id i Dashboard>",
  "name": "...", "style": "...", "batch_number": "...",
  "og": 1.062, "fg": 1.012, "volume_l": 20,
  "yeasts": [{ "name": "...", "min_temp": 18, "max_temp": 22 }],
  "fermentation_start": null
}
```

`source_id` gör anropet idempotent — samma brygg kan skickas om utan dubbletter.
Det arbetet görs i det andra projektet; säg till så tar vi det där när den här delen är klar.

## Teknisk sammanfattning

- `supabase/functions/pi-control/index.ts`: pending-cutoff 24 h → 7 dygn.
- Migration: `archive_empty_brew_drafts()` får `AND b.pi_pending_at IS NULL`.
- `supabase/functions/receive-brew/index.ts`: skriver `pending_notifications` vid ny brygg
  (bara när `pi_pending_at` var tomt innan, så omsändningar inte spammar).
- `src/components/BrewManagement.tsx`: separat kösektion med tidsstämpel och "ta bort ur kön".
