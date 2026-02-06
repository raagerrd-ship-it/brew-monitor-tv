

## Optimering av bakgrundsprocesser + borttagning av FPS/minnesovervakning

### Oversikt
Ta bort FPS-raknaren och minnesovervakningen helt, samt optimera ovriga bakgrundsprocesser for battre prestanda i TV-laget.

### 1. Ta bort FPS-raknaren (4 filer)

FPS-raknaren anvander kontinuerlig `requestAnimationFrame` och en Supabase realtime-kanal + databasfraga bara for att visa/dolja den. Allt detta tas bort:

- **Radera** `src/components/FpsCounter.tsx`
- **Radera** `src/contexts/FpsCounterContext.tsx`
- **`src/App.tsx`**: Ta bort import av `FpsCounterProvider` och `FpsCounter`, ta bort `<FpsCounterProvider>`-wrappern (rad 8-9, 11, 58, 76, 78)
- **`src/pages/Settings.tsx`**: Ta bort import av `useFpsCounter` (rad 28), ta bort all UI-kod for FPS-toggle (sokningen: "FPS-raknare" eller "show_fps_counter")

### 2. Ta bort use-memory-monitor (2 filer)

Minnesovervakningen kollar heapen var 60:e sekund och laddar om sidan vid 90%. I praktiken ar det sallsynt att den triggas, och auto-reload vid versionscheck hanterar redan periodiska omladdningar.

- **Radera** `src/hooks/use-memory-monitor.ts`
- **`src/components/BrewingDashboard.tsx`**: Ta bort import (rad 20) och anropet `useMemoryMonitor(90, 60000, isTvMode)` (rad 118)

### 3. Optimera klockan i TV-lage (1 fil)

Klockan uppdateras varje sekund pa alla enheter. I TV-lage behover sekunderna inte visas.

- **`src/components/Clock.tsx`**: I TV-lage, uppdatera intervallet till 60 sekunder och dolj sekunderna. Behall 1-sekundsintervall for desktop.

### 4. Optimera extern timer-backup-polling (1 fil)

`use-external-timer.ts` pollar cachen var 10:e sekund som backup. Eftersom realtime-prenumeration ar aktiv kan detta okas till 60 sekunder.

- **`src/hooks/use-external-timer.ts`**: Andra `setInterval` fran 10000 till 60000 (rad 343)

### 5. Forenkla glow-effekt-timeout (1 fil)

`use-brew-data.ts` har en 120-sekunders timeout for glow-effekter (rad 514-520). I TV-lage kan denna stangas av helt for att spara minnesanvandning (farre timers).

- **`src/hooks/use-brew-data.ts`**: Skicka in `isTvMode` och skippa `setUpdatedFields` + timeout helt i TV-lage

### 6. Ta bort DashboardDebugOverlay och TvDebugOverlay (3 filer)

Debug-overlayen ar redan hardkodad till `showDebug = false` (rad 62 i BrewingDashboard). Den importeras i onodan och innehaller tung logik (PerformanceObserver, console.error-interceptor, globala `__perfTimings`).

- **Radera** `src/components/DashboardDebugOverlay.tsx`
- **Radera** `src/components/TvDebugOverlay.tsx`
- **`src/components/BrewingDashboard.tsx`**: Ta bort importer (rad 8-9), ta bort `showDebug`-variabeln och hela JSX-blocket for `TvDebugOverlay` (rad 62, 263-265)

### Sammanfattning av borttagna processer

| Process | Intervall | Borttagen/Andrad |
|---|---|---|
| FPS-raknare (requestAnimationFrame-loop) | Kontinuerlig | Borttagen |
| FPS realtime-kanal (fps-counter-settings) | Realtid | Borttagen |
| Minnesovervakning (heap check) | 60s | Borttagen |
| Debug overlay (PerformanceObserver + console.error) | Kontinuerlig | Borttagen |
| Klocka (sekund-uppdatering) | 1s | 60s i TV-lage |
| Timer backup-poll | 10s | 60s |
| Glow-effekt timers | 120s per uppdatering | Av i TV-lage |

### Kvarstaende processer (oforandrade)

| Process | Intervall | Anledning |
|---|---|---|
| Realtime: brew_readings | Realtid (2s batch i TV) | Karnfunktion |
| Realtime: rapt_pills | Realtid (2s batch i TV) | Karnfunktion |
| Realtime: rapt_temp_controllers | Realtid (2s batch i TV) | Karnfunktion |
| Realtime: selected_brews/pills/controllers | Realtid | Fjarrstyrning |
| Realtime: fermentation_sessions | Realtid | Karnfunktion |
| Realtime: cached_external_timer | Realtid | Timer-visning |
| Sonos polling | 5s | Musikvisning i TV |
| Versionscheck | 300s (TV) / 60s (desktop) | Auto-uppdatering |

