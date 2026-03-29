

# Lägg till Recharts/SVG-toggle i TV-styrning

## Ändring

En enda fil ändras: `src/pages/Settings.tsx`.

I sektionen **"TV-styrning"** (rad ~443–471), lägg till en ny rad efter "Splash-fördröjning" med en `Switch` som styr om TV-läge ska använda interaktiva Recharts-diagram istället för server-renderade SVG.

- Label: **"Interaktiva diagram"**
- Beskrivning: *"Använd samma diagram som desktop istället för SVG-bilder"*
- Värdet sparas i `localStorage` under nyckeln `tv-use-recharts` (`"true"` / `"false"`)
- Default: `true` (Recharts aktivt)

I `LazyBrewChart.tsx` — läs flaggan från `localStorage` och visa `BrewChartLazy` (Recharts) eller `TvModeChart` (SVG) baserat på den.

## Filer

| Fil | Ändring |
|-----|---------|
| `src/pages/Settings.tsx` | Ny Switch-rad i TV-styrning-sektionen |
| `src/components/brew-chart/LazyBrewChart.tsx` | Läs `localStorage`-flagga, villkorligt rendera Recharts vs SVG i TV-läge |

