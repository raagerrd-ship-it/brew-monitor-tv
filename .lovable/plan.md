

# Uppdaterad plan: Automationsfoerbattringar

## Oversikt

Implementera foerbattringar foer att goera automationen mer robust och saeker. Notera att befintliga `min_target_temp` / `max_target_temp` per controller redan anvaends som saekerhetsgranser foer alla justeringar -- ingen separat `max_stall_boost_24h`-kolumn behoevs.

## Aendringar

### 1. Overshoot Recovery
Automatisk aaterhaemtning av `target_temp` till `original_target_temp` naer overshoot avklingat.

- I overshoot-loopen: om `pill_temp < original_target + overshoot_pill_threshold` OCH `target_temp < original_target`, aaterstall target till `original_target`
- Logga som `OVERSHOOT_RECOVERY`
- Spara justering med reason som indikerar recovery
- **Begransas av controllerns `max_target_temp`** -- kan aldrig aaterstalla oever max

### 2. Stall-boost saekerhet via min/max
Ingen ny databaskolumn. Befintliga `min_target_temp` och `max_target_temp` per controller anvaends redan som absoluta graenser:

- AI-foerslag klippas mot `[min_target_temp, max_target_temp]` (redan implementerat rad 466-468)
- Fallback-boost klippas mot `max_target_temp` (redan implementerat rad 509-511)
- Overshoot klippas mot `[min_target_temp, max_target_temp]` (redan implementerat rad 757-768)
- **Ingen ytterligare kodaendring behoevs** -- detta aer redan paa plats

### 3. Timeout-skydd i orchestratorn (`run-automation`)
Lagg till `AbortSignal.timeout()` per steg foer att foerhindra att hela orchestratorn timeout:ar.

```text
Steg 1 (fermenteringsprofiler): 15s timeout (ingen AI)
Steg 2 (jaestanksjustering):    20s timeout (kan anropa AI)
Steg 3 (glykolkylare):          20s timeout
```

- Om ett steg timeout:ar loggas det som error men naesta steg koers aendaa
- Lagg till `signal` parameter i `runStep`-funktionens fetch-anrop

### 4. Faersk data i glycol-steget
Se till att steg 3 (Glykolkylare) anvaender uppdaterade `target_temp`-vaerden fraan steg 2.

- `run-automation`: Faanga returvaerdet fraan steg 2 (`tankResult`)
- Skicka med `tankAdjustments` i request body till steg 3
- `auto-adjust-cooling` glycol-cooler: Oeverskirv `target_temp` i `followedControllersFullData` med vaerden fraan `tankAdjustments` innan berakning av laegsta target

### 5. Glykolkylare aaterhaemtning
Gradvis hoejning av kylaren tillbaka mot baseline naer inget aktivt kylbehov finns.

- I glycol-cooler `else`-grenen (naer controllern INTE aktivt kyler):
  - Beraekna idealt maaltarget: `lowestTargetTemp - temp_reduction_degrees`
  - Om nuvarande cooler target aer laegre aen idealt, hoej stegvis (t.ex. halva skillnaden)
  - **Begransas av kylarkontrollerns `min_target_temp` / `max_target_temp`**
  - Logga som `COOLING_RECOVERY`

## Teknisk sammanfattning

| Aendring | Fil | Typ |
|---|---|---|
| Overshoot recovery | `auto-adjust-cooling/index.ts` | ~30 rader ny logik i overshoot-sektionen |
| Min/max som saekerhet | Redan implementerat | Ingen aendring |
| Timeout-skydd | `run-automation/index.ts` | ~10 rader (AbortSignal + signal i fetch) |
| Faersk data glycol | `run-automation/index.ts` + `auto-adjust-cooling/index.ts` | ~20 rader |
| Glycol recovery | `auto-adjust-cooling/index.ts` | ~25 rader i glycol-cooler-sektionen |

**Totalt**: 0 databasmigrationer, 2 edge functions uppdaterade, inga UI-aendringar.

