

## Plan: Centralisera "Är-temperatur"-beräkningen

### Problemet
Temperaturen beräknas olika på minst 4 ställen:

| Plats | Logik | Problem |
|-------|-------|---------|
| `TempStat.tsx` | Alltid `avg(pill, probe)` | Ignorerar `pillCompEnabled` |
| `RaptControllersManagement.tsx` | `pill_temp ?? current_temp` | Ingen avg, ingen pillComp-check |
| `AutomationFeatureStatus.tsx` | Egen logik per controller | Inkonsekvent med TempStat |
| Backend (`auto-adjust-cooling`) | `pill_temp ?? current_temp` | Annan definition än frontend |

### Lösning: En delad hjälpfunktion

**1. Skapa `src/lib/temp-display.ts`** — en enda funktion som beräknar "Är-temp":

```text
getActualTemp(pillTemp, probeTemp, pillCompEnabled) =>
  pillCompEnabled && both exist ? avg(pill, probe)
  : probeTemp ?? pillTemp
```

Samt en `getActualTempLabel()` som returnerar `"(snitt)"` eller `"(probe)"`.

**2. Uppdatera `TempStat.tsx`** — importera och använd `getActualTemp` med `pillCompEnabled`-prop (redan planerat från förra planen).

**3. Uppdatera `RaptControllersManagement.tsx`** — byt `pill_temp ?? current_temp` mot `getActualTemp`. Kräver att `pillCompEnabled` hämtas (finns redan i `useSettingsData`).

**4. Uppdatera `AutomationFeatureStatus.tsx`** — använd samma funktion för controller-raderna i PID-blocket.

**5. Propagera `pillCompEnabled` genom komponentkedjan:**
- `use-brew-data.ts` / `use-brew-page.ts`: hämta `pill_compensation_enabled` från `auto_cooling_settings`
- Skicka som prop genom `BrewingDashboard` → `BrewCard` → `TempStat`
- `RaptControllersManagement` har redan tillgång via `useSettingsData`

### Filer som ändras
- **Ny:** `src/lib/temp-display.ts`
- `src/components/brew-card/TempStat.tsx`
- `src/components/brew-card/types.ts` (ny prop `pillCompEnabled`)
- `src/components/brew-card/BrewCard.tsx` (propagera prop)
- `src/components/BrewingDashboard.tsx` (hämta och skicka `pillCompEnabled`)
- `src/components/RaptControllersManagement.tsx`
- `src/components/AutomationFeatureStatus.tsx`
- `src/hooks/use-brew-data.ts` eller `src/hooks/use-brew-page.ts` (fetcha `pillCompEnabled`)

