

## Ytterligare optimeringar av klientens resurser

### 1. Ta bort chart-polling i TV-läge

**Problem:** Varje ölkort i TV-läge pollar `render-brew-chart` edge function var 15:e minut. Med 3 öl = 3 extra nätverksanrop var 15:e minut.

**Lösning:** Ta bort `setInterval` i `LazyBrewChart`. Diagrambilden uppdateras redan när `lastUpdateRaw` ändras (via realtime), vilket triggar ett nytt `fetchChart`-anrop. 15-minutersintervallet är onödigt eftersom data bara ändras när cron-jobbet skriver ny data (som redan triggar realtime-uppdateringen).

### 2. Konsolidera realtime-kanaler

**Problem:** Det finns flera separata WebSocket-kanaler utöver de två konsoliderade (`data-updates` och `config-updates`):
- `sonos-now-playing` (SonosWidget)
- `sonos-bg-settings` (BrewingDashboard)
- `cached-timer-updates` (use-external-timer)
- `tv-force-refresh` (BrewingDashboard, bara TV-läge)

Varje kanal = en egen WebSocket-anslutning som belastar CPU och minne.

**Lösning:** Konsolidera dessa till de befintliga kanalerna:
- Flytta `sonos_now_playing` och `sonos_settings` till `data-updates`-kanalen i `use-brew-data.ts`
- Flytta `cached_external_timer` och `sync_settings` (force refresh) till `config-updates`-kanalen
- Ta bort de separata kanalerna i respektive komponent och istället exponera callbacks via props eller context

### 3. Ta bort backup-polling för extern timer

**Problem:** `use-external-timer.ts` pollar `fetchFromCache()` var 60:e sekund som backup. Realtime-kanalen fungerar redan pålitligt.

**Lösning:** Ta bort 60-sekunders `setInterval` helt. Realtime-prenumerationen räcker.

### Tekniska detaljer

**Fil: `src/components/brew-chart/LazyBrewChart.tsx`**
- Ta bort `setInterval(fetchChart, REFRESH_INTERVAL_MS)` (rad 44)
- Behåll bara `fetchChart()` vid mount och vid `lastUpdateRaw`-ändring

**Fil: `src/hooks/use-brew-data.ts`**
- Lägg till `.on('postgres_changes', { table: 'sonos_now_playing' }, ...)` i `data-updates`-kanalen
- Lägg till `.on('postgres_changes', { table: 'sonos_settings' }, ...)` i `data-updates`-kanalen  
- Lägg till `.on('postgres_changes', { table: 'cached_external_timer' }, ...)` i `config-updates`-kanalen
- Lägg till `.on('postgres_changes', { table: 'sync_settings' }, ...)` i `config-updates`-kanalen
- Exponera callbacks via return-objektet

**Fil: `src/components/sonos/SonosWidget.tsx`**
- Ta bort den separata `sonos-now-playing` realtime-kanalen (rad 98-113)
- Ta emot uppdateringar via prop/callback istället

**Fil: `src/components/BrewingDashboard.tsx`**
- Ta bort den separata `sonos-bg-settings` kanalen (rad 71-83)
- Ta bort den separata `tv-force-refresh` kanalen (rad 144-177)
- Prenumerera på dessa via `use-brew-data` hookens callbacks

**Fil: `src/hooks/use-external-timer.ts`**
- Ta bort `setInterval(fetchFromCache, 60000)` (rad 342-344)
- Ta bort den separata `cached-timer-updates` kanalen (rad 326-339)
- Ta emot uppdateringar via prop/callback

### Resultat
- 4 färre WebSocket-kanaler (4 borttagna, 0 nya)
- Tar bort chart-polling (3 nätverksanrop / 15 min)
- Tar bort timer backup-polling (1 anrop / minut)
- Totalt: enklare arkitektur och lägre CPU/nätverksbelastning

