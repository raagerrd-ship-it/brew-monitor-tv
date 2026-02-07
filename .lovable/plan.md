

## Analys: Klientens kvarvarande tunga operationer

### Sammanfattning

Applikationen ar redan valoptimerad efter de senaste andringarna. Jag har gatt igenom alla filer och identifierat alla `setInterval`, realtime-kanaler, och natverksanrop. De flesta ar nodvandiga eller redan avgransade till dialoger/installningssidor.

### Redan optimerat (inget att gora)

- Sonos-polling: flyttad till server-side cron
- Chart-polling (15 min): borttagen
- Timer backup-polling (60s): borttagen
- Realtime-kanaler: konsoliderade fran 7 till 2
- TV-mode: server-renderade chart-bilder, glow avaktiverat, batchade uppdateringar

### Kvarvarande intervaller (alla nodvandiga)

| Komponent | Intervall | Syfte | Kommentar |
|-----------|-----------|-------|-----------|
| Clock | 1s | Visa aktuell tid | Nodvandig |
| SonosWidget progress | 1s | Progress bar for lat | Nodvandig, aktiv bara vid uppspelning |
| Timer countdown | 1s | Visa nedrakning | Nodvandig, aktiv bara nar timer kors |
| Fermentation progress tick | 5s (30s TV) | Uppdatera steg-progress | Rimlig, uppdaterar bara vid minutbyte |
| ExternalAuth refresh | 30 min | Fornya session-token | Nodvandig for att halla sessionen vid liv |
| Controller temp (chart) | 5 min (TV) | Hamta controller-temp for chart | Laddas aldrig i TV-mode (server-bild) |
| AutoCoolingCountdown | 250ms | Visa nedrakning i dialog | Bara aktiv inuti RaptControllerDialog |

### Enda kvarvarande optimeringsmojlighet

**Duplicerade fermenterings-realtime-kanaler**

`ActiveFermentationSession` skapar **2 extra realtime-kanaler per olkort** (i vanligt lage, ej TV) via `useRealtimeSubscription`:
- En for `fermentation_sessions` (filter: `brew_id=eq.X`)
- En for `rapt_temp_controllers` (filter: `controller_id=eq.X`)

Med 3 ol = 6 extra WebSocket-kanaler. Dessa tabeller overvakas redan av de konsoliderade kanalerna i `use-brew-data.ts`.

Dock:
- I TV-mode ar dessa redan avaktiverade (`enabled: !isTvMode`)
- De konsoliderade kanalerna i `use-brew-data.ts` hanterar redan uppdateringar for dessa tabeller och uppdaterar state direkt
- De filtrerade kanalerna i `ActiveFermentationSession` anvands for att trigga `loadSession()`, men sessionsdata laddas redan i `loadBrewsInternal()` som del av preloaded session

**Mojlig atgard:** Ta bort `useRealtimeSubscription`-anropen i `ActiveFermentationSession` helt. Komponenten anvander redan `preloadedSession` som uppdateras via de konsoliderade kanalerna. Nar `brew_readings` eller `rapt_temp_controllers` uppdateras i realtime, uppdateras `preloadedSession` via `handleBrewUpdate` -> `loadBrews()` -> ny `fermentationSession` prop.

### Teknisk detalj

**Fil: `src/components/fermentation/ActiveFermentationSession.tsx`**
- Ta bort `useRealtimeSubscription` for `fermentation_sessions` (rad 230-239)
- Ta bort `useRealtimeSubscription` for `rapt_temp_controllers` (rad 243-257)
- Ta bort `import { useRealtimeSubscription }` (rad 27)
- Uppdatera `controllerData` via preloaded session-data istallet (redan delvis gjort)

**Resultat:**
- 2 farre WebSocket-kanaler per olkort (6 totalt med 3 ol) i vanligt lage
- Ingen funktionalitetsforlust - data uppdateras redan via konsoliderade kanaler
- Marginell forbattring - mest relevant for enheter med begransade resurser

### Slutsats

Applikationen ar i stort sett fullt optimerad. Den enda aterstaende forandringen ar att ta bort 6 duplicerade realtime-kanaler, vilket ger en marginell forbattring. Alla andra intervaller och operationer ar antingen nodvandiga eller redan avgransade till specifika vyer.

