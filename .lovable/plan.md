
## Djupanalys av Sonos-integrationen -- Runda 5

### Sammanfattning

Koden ar i mycket bra skick efter fyra rundor. Denna granskning identifierar **2 sma problem** -- bada lag prioritet.

---

### Problem 1: `sonos-auth` och `sonos-groups` anvander olika Supabase-importsokvagar

**Filer:** `supabase/functions/sonos-auth/index.ts` rad 2, `supabase/functions/sonos-groups/index.ts` rad 2

```ts
// sonos-auth & sonos-groups:
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// sync-sonos-now-playing & sonos-playback-status:
import { createClient } from "npm:@supabase/supabase-js@2";
```

Tva edge functions anvander `esm.sh`-importen medan de tva nyare anvander `npm:`-specifiern. Bada fungerar i Deno, men `npm:` ar den rekommenderade metoden for Deno 1.28+ och ger battre kompatibilitet. Inkonsistensen ar inte en bugg men kan skapa forvirring vid framtida underhall.

**Fix:** Ersatt `https://esm.sh/@supabase/supabase-js@2` med `npm:@supabase/supabase-js@2` i `sonos-auth` och `sonos-groups`.

---

### Problem 2: `sonos-auth` `action=refresh` ar oanvand och duplicerar delad logik

**Fil:** `supabase/functions/sonos-auth/index.ts`, rad 120-176

`action=refresh`-grenen implementerar token-fornyelse manuellt -- exakt samma logik som nu finns i `_shared/sonos-token.ts` via `getValidAccessToken()`. Ingen klient- eller serverkod anropar nagonsin `sonos-auth?action=refresh`. Det ar dod kod som kan forvirra och som divergerar fran den delade implementationen om nagot andras dar.

**Fix:** Ta bort hela `action=refresh`-grenen (rad 120-176). Om token-fornyelse nagonsin behovs manuellt kan `getValidAccessToken` anropas direkt.

---

### Implementationsplan

| Prioritet | Fil | Andring |
|-----------|-----|---------|
| LAG | `sonos-auth/index.ts` rad 2 | `esm.sh` -> `npm:` import |
| LAG | `sonos-groups/index.ts` rad 2 | `esm.sh` -> `npm:` import |
| LAG | `sonos-auth/index.ts` rad 120-176 | Ta bort oanvand `action=refresh`-gren |

---

### Bekraftat korrekt efter 5 rundor

- **Token-hantering:** Konsoliderad i delad hjalpfil, alla `await`, scope korrekt
- **Prefetch-installning:** Hamtas korrekt fran DB, anvands via ref
- **Client polling:** Ingen stale closure, `nowPlayingRef` anvands, bakgrunds-safeguard
- **Realtime:** 15s cooldown, sparmedveten, position villkorad pa accept-flagga
- **Ticker:** DOM-baserad progress, prediktiv polling, prefetch, early swap, timeout
- **Auth headers:** Konsekvent pa alla edge function-anrop
- **Environment-variabler:** Inga hardkodade URL:er kvar
- **Disconnect:** Full cleanup via edge function
- **isTvMode:** Skickas korrekt till widgeten
- **imageError:** Aterstalls vid ny art URL
- **triggerServerSync:** 15s timeout via AbortController
- **Bild-preloading:** Korrekt preload-kedja for current + next art + background
- **Visibility:** 5s grace period, PAUSED/IDLE-hantering korrekt
- **Edge functions:** Parallella API-anrop, chunk-baserad base64, error handling

Koden ar nu i ett stabilt och konsekvent tillstand. De tva kvarvarande problemen ar rengoringsuppgifter utan funktionell paverkan.
