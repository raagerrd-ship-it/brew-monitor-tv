

## Nollställ kylningshastighet för Controller Blå

**Vad:** Uppdatera raden i `fermentation_learnings` för Controller Blå (`ffa62be4-d6f7-4533-83b4-57ad93c3ac01`, parameter `thermal_rate_cooling`) från 11.81°C/h till grundvärde 2.0°C/h och återställ `sample_count` till 1.

**Hur:** Kör en SQL UPDATE via insert-verktyget:
```sql
UPDATE fermentation_learnings 
SET learned_value = 2.0, 
    sample_count = 1, 
    last_updated_at = now() 
WHERE controller_id = 'ffa62be4-d6f7-4533-83b4-57ad93c3ac01' 
  AND parameter_name = 'thermal_rate_cooling';
```

Ingen kodändring behövs — enbart en datauppdatering. Värdet 2.0°C/h kommer sedan gradvis justeras av EMA-algoritmen baserat på framtida faktiska mätningar.

