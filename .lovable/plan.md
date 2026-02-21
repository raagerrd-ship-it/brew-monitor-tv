
# Fix: Splash-skärmen blinkar innehåll bakom

## Orsak

Splash-overlayen i `BrewingDashboard.tsx` har klassen `animate-in fade-in duration-500`. Detta gör att splashen **fadar in fran transparent till synlig** under 500ms. Under den tiden syns dashboardinnehallet ("Inga ol valda") bakom overlyen.

## Losning

**Fil: `src/components/BrewingDashboard.tsx`**

1. Ta bort `animate-in fade-in duration-500` fran splash-overlayens className sa den ar omedelbart synlig (opacity: 1) fran forsta renderingen.

2. Lagg istallet till en fade-out-animation nar `showSplash` blir `false`. Det enklaste sattet ar att anvanda en extra state (`splashFadingOut`) med en CSS-transition:
   - Nar `showSplash` blir `false`, satt `splashFadingOut = true` och starta en timer (500ms)
   - Under fade-out, applicera `opacity-0 transition-opacity duration-500`
   - Nar timern gar ut, ta bort splashen helt fran DOM

### Alternativ (enklare variant)
Om vi vill halla det minimalt: ta bara bort `animate-in fade-in duration-500` sa splashen visas direkt utan animation. Den forsvinner abrupt nar data ar redo, men det ar battre an att visa "Inga ol valda" forst.

Jag rekommenderar den enklare varianten for att undvika extra komplexitet.

## Teknisk detalj

Andring pa en rad i `src/components/BrewingDashboard.tsx`:

Fran:
```
className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center gap-4 animate-in fade-in duration-500"
```

Till:
```
className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center gap-4"
```
