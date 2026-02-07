
# Optimeringsplan – Klientens resurser

## Status: ✅ Alla optimeringar genomförda

---

### ✅ Genomförda optimeringar

| # | Åtgärd | Detaljer |
|---|--------|---------|
| 1 | Sonos-polling → server-side cron | Polling flyttad till cron-jobb, klienten prenumererar via realtime |
| 2 | Chart-polling (15 min) borttagen | `setInterval` i `LazyBrewChart` borttagen, uppdateras via `lastUpdateRaw` |
| 3 | Timer backup-polling (60s) borttagen | `setInterval(fetchFromCache, 60000)` i `use-external-timer.ts` borttagen |
| 4 | Realtime-kanaler konsoliderade (7→2) | `sonos-now-playing`, `sonos-bg-settings`, `cached-timer-updates`, `tv-force-refresh` flyttade till `data-updates`/`config-updates` |
| 5 | Duplicerade fermenterings-kanaler borttagna | 2 `useRealtimeSubscription` per ölkort i `ActiveFermentationSession` borttagna (upp till 6 kanaler med 3 öl) |
| 6 | TV-mode: server-renderade chart-bilder | Recharts-komponenter laddas aldrig i TV-läge |
| 7 | TV-mode: glow-animationer avaktiverade | CSS-animationer på brew-uppdateringar avstängda |
| 8 | TV-mode: batchade realtime-uppdateringar | 2s fördröjning i `data-updates`-kanalen för att minska re-renders |

---

### Kvarvarande intervaller (alla nödvändiga, ingen åtgärd krävs)

| Komponent | Intervall | Syfte | Kommentar |
|-----------|-----------|-------|-----------|
| Clock | 1s | Visa aktuell tid | Nödvändig |
| SonosWidget progress | 1s | Progress bar för låt | Aktiv bara vid uppspelning |
| Timer countdown | 1s | Visa nedräkning | Aktiv bara när timer körs |
| Fermentation progress tick | 5s (30s TV) | Uppdatera steg-progress | Uppdaterar bara vid minutbyte |
| ExternalAuth refresh | 30 min | Förnya session-token | Nödvändig |
| Controller temp (chart) | 5 min | Hämta controller-temp för chart | Laddas aldrig i TV-mode |
| AutoCoolingCountdown | 250ms | Visa nedräkning i dialog | Bara aktiv inuti RaptControllerDialog |

---

### Slutsats

Applikationen är fullt optimerad. Alla identifierade onödiga nätverksanrop, polling-intervaller och duplicerade WebSocket-kanaler har eliminerats. Kvarvarande intervaller är nödvändiga för realtidsvisning i UI och är korrekt avgränsade till sina respektive vyer.
