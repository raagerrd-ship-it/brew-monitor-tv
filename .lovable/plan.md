

# Redesign RAPT Controller Bar

## Ändringar

### 1. Ta bort batteriprocent-texten, ersätt med batteribar
- Ta bort `{Math.floor(linkedPill.battery_level)}...%` texten
- Lägg till en tunn horisontell progress-bar under hela controller-itemet (hela bredden)
- Baren visar batterinivån, färgad med controllerns färg
- Låg batterinivå (<20%) → röd/orange färg

### 2. Lägg till Pill/Controller-ikoner med aktiv-markering
- Visa två små ikoner: `Pill` och `AirVent` (controller)
- Markera vilka som är aktiva/kopplade:
  - Pill-ikonen lyser i sin färg om `linkedPill` finns och inte är stale
  - Controller-ikonen lyser alltid (den finns ju)
  - Inaktiv/saknad → dimmad/opacity
- Ersätter den nuvarande enskilda `AirVent`/`Pill`-ikonen

### 3. Gör baren lite högre
- Öka vertikal padding från `py-1` till `py-1.5` på desktop för att ge mer utrymme åt batteribaren undertill

## Layout per controller-item (desktop)
```text
┌─────────────────────────────┐
│  🌡️ 🎛️  19.3°              │
│  ▓▓▓▓▓▓▓▓▓▓▓▓░░░░  (72%)   │
└─────────────────────────────┘
  Pill  Controller   Temp
  icon  icon         
```

Pill-ikon i färg om kopplad, dimmad annars. Controller-ikon alltid synlig. Batteribar under i controllerfärg.

## Fil som ändras
- `src/components/DashboardHeader.tsx` — `RaptControllerBar`-komponenten

