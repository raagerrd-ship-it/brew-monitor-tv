

## Arkivera ALLA Brewfather-batchar

**Vad:** Sätt status till `'Arkiverad'` på samtliga poster i `brew_readings` där `batch_id` INTE börjar med `custom_`.

**SQL (via insert-verktyget):**
```sql
UPDATE brew_readings SET status = 'Arkiverad' WHERE batch_id NOT LIKE 'custom_%';
```

Detta påverkar alla Brewfather-batchar oavsett nuvarande status (Jäsning, Konditionering, Klar, etc.).

Custom-bryggningar (batch_id som börjar med `custom_`) lämnas orörda.

