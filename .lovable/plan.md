

# UI-polering -- 3 forbattringar

## 1. Tooltip-text i header har fortfarande "°C"

Controller-barens hover-tooltip visar `°C` trots att alla synliga varden nu anvander `°`. En enkel textersattning for konsistens.

**Fil:** `src/components/DashboardHeader.tsx` rad 170

## 2. Branded laddningsskarm

Nuvarande laddningssida visar bara en generisk spinner. Byter till logotypen med fade-in-animation for en mer professionell forstaintryck.

**Fil:** `src/components/BrewingDashboard.tsx` rad 280-282
- Importera `Logo` och visa den ovanfor spinnern
- Lagg till fade-in-animation och dammad spinner-farg

## 3. Temperaturenhet i DashboardHeader tooltip

Alla `°C` i tooltip-texten (rad 170) ersatts med `°`.

---

## Teknisk sammanfattning

### DashboardHeader.tsx (rad 170)
Ersatt alla `°C` med `°` i title-attributets strang.

### BrewingDashboard.tsx (rad 280-282)
```tsx
return (
  <div className="min-h-screen w-full bg-background flex flex-col items-center justify-center gap-4 animate-in fade-in duration-500">
    <Logo />
    <Loader2 className="h-8 w-8 animate-spin text-primary/40" />
  </div>
);
```
Kraver import av `Logo` fran `./Logo`.

