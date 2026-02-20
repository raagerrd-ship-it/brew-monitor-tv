

# Prestandaoptimering -- TV-mode och nätverkstrafik

Klockan behåller sekundvisning som du vill. Övriga optimeringar genomförs:

## Vad ändras

### 1. Ta bort dubbla timer-hooks (störst effekt)
`TimerFooter` skapar egna instanser av `useExternalTimer` och `useExternalUserSettings`, trots att `BrewingDashboard` redan kör samma hooks. Det innebär dubbla edge function-anrop (var 3:e sekund), dubbla databaspolls (var 5:e sekund) och dubbla Realtime-kanaler.

Lösning: Flytta timer-data från `BrewingDashboard` ner till `TimerFooter` via props istället.

- `AspectRatioLayout.tsx` -- Lägg till props-vidarebefordring från dashboard till TimerFooter via en React context eller lyft TimerFooter in i BrewingDashboard
- `TimerFooter.tsx` -- Ta bort egna `useExternalTimer()` och `useExternalUserSettings()`, ta emot data som props istället

### 2. Minska TV force-refresh polling
`BrewingDashboard.tsx` pollar `sync_settings` var 10:e sekund (rad 177) för force-refresh. Realtime hanterar det snabba fallet redan, pollning är bara fallback.

Lösning: Öka intervallet från 10 000ms till 30 000ms.

### 3. Idle-läge för timer-synk
`useExternalTimer` triggar edge function var 3:e sekund och pollar databasen var 5:e sekund oavsett om en timer faktiskt körs. När ingen timer är aktiv slösas resurser.

Lösning: Efter initial hämtning, om ingen timer är aktiv, växla till långsamt läge (30s sync, 60s poll). När timer aktiveras via Realtime eller poll, växla till snabbt läge (3s sync, 5s poll).

---

## Tekniska detaljer

### TimerFooter props-refaktorering

Eftersom `TimerFooter` renderas i `AspectRatioLayout.tsx` (utanför `BrewingDashboard`), behöver vi en av två strategier:

**Alternativ A (enklast):** Flytta `TimerFooter` in i `BrewingDashboard` istället för `AspectRatioLayout`, och skicka timer-state som props. Dashboard har redan all data.

**Alternativ B:** Skapa en liten TimerContext som BrewingDashboard fyller med sin existerande timer-data, och som TimerFooter konsumerar.

Jag föreslår **Alternativ A** -- enklare och färre abstraktioner.

### Fil: `src/components/AspectRatioLayout.tsx`
- Ta bort `<TimerFooter />` därifrån

### Fil: `src/components/BrewingDashboard.tsx`
- Importera och rendera `<TimerFooter>` direkt, med props:
  ```
  <TimerFooter timer={externalTimer} timerTvModeOnly={timerTvModeOnly} />
  ```
- Ändra polling-intervall från 10000 till 30000 (rad 177)

### Fil: `src/components/TimerFooter.tsx`
- Ändra signatur till att ta emot `timer` och `timerTvModeOnly` som props
- Ta bort interna `useExternalTimer()` och `useExternalUserSettings()`-anrop

### Fil: `src/hooks/use-external-timer.ts`
- Lägg till idle/active-läge:
  - Håll koll på `isActive` från senaste fetch
  - Om inaktiv: syncInterval = 30s, pollInterval = 60s
  - Om aktiv: syncInterval = 3s, pollInterval = 5s
  - Växla dynamiskt när status ändras via Realtime-callback

### Förväntad effekt
- Ca 50% färre nätverksanrop relaterade till timern (dubbel instans elimineras)
- Dramatiskt färre anrop när ingen timer körs (idle-läge)
- Minskad polling för force-refresh (10s till 30s)
- Mindre CPU/minne på Chromecast-hårdvara

