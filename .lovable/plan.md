

## Plan: Visa inlärda glykolkylarmarginaler i Inlärning-sektionen

### Bakgrund
Systemet sparar redan inlärda kylmarginaler i `fermentation_learnings`-tabellen med `parameter_name` som `cooler_margin:cold`, `cooler_margin:cool`, `cooler_margin:warm`, `cooler_margin:hot`. Dessa visas inte i UI:t idag.

### Implementering

**Ny komponent: `src/components/LearnedCoolerMarginValues.tsx`**

Skapas efter samma mönster som `LearnedStallBoostValues.tsx`:
- Hämtar alla rader från `fermentation_learnings` där `parameter_name` börjar med `cooler_margin:`
- Slår upp controller-namn från `rapt_temp_controllers`
- Grupperar per controller och visar varje temperatur-bucket med:
  - Bucket-etikett: Kall (<5°), Sval (5-12°), Varm (12-18°), Het (>18°)
  - Inlärt marginalvärde i °C (Badge med blå/cyan-accent, Snowflake-ikon)
  - Antal mätningar och tid sedan senaste uppdatering
- Tom-state med Snowflake-ikon och text om att systemet lär sig under drift
- Refresh-knapp

**Uppdatering: `src/pages/Settings.tsx`**

I Inlärning-sektionen (rad 1833-1843), lägg till den nya komponenten med en `SettingsDivider` mellan befintliga och nya:

```
<LearnedStallBoostValues />
<SettingsDivider />
<LearnedCompensationBaselines />
<SettingsDivider />
<LearnedCoolerMarginValues />
```

### Ingen databasändring krävs
Data finns redan i `fermentation_learnings`-tabellen.

