

# Synkanalys: Stabilitet och risker vid aktiv profil

## Sammanfattning

Systemet är **genomgående välskyddat** med isolering, stale guards, säkerhetsspärrar och gracil degradering. Jag hittade **3 potentiella problem** och **2 observationer** att vara medveten om.

---

## Problem 1: Full-sync kan köra quick-sync utan concurrency guard

`full-sync-brew-data` anropar `sync-rapt-data-quick` i Steg 3. Men quick-sync har en concurrency guard som skippar om senaste loggen är <30s gammal. Om en cron-triggad quick-sync **just körde klart**, kommer full-syncs anrop att passera guarden — men om en **ny** cron-triggad quick-sync triggas medan full-syncs quick-sync fortfarande kör, kan de **överlappa**.

**Risk vid aktiv profil:** Två parallella automationscykler kan skicka motstridiga `target_temp`-uppdateringar till RAPT API:et (t.ex. PID sänker till 18.5° i den ena, medan den andra fortfarande arbetar med 18.7°).

**Sannolikhet:** Låg — full-sync körs var 6:e timme, men om den råkar sammanfalla med en cron-cykel uppstår en ~20s lucka.

**Fix:** Lägg till ett explicit lås (t.ex. via en `sync_lock`-rad i DB med timestamp) eller se till att full-sync's quick-sync-anrop **respekteras** av concurrency guarden genom att logga ett "reservation"-entry innan anropet.

---

## Problem 2: Manuell ändring vid profil ändrar INTE profile_target_temp

I Phase 1c (rad 406-413): när en manuell hårdvaruändring detekteras på en profilstyrd styrenhet, uppdateras `target_temp` till det nya hårdvaruvärdet — men `profile_target_temp` uppdateras **bara** för kylaren (`isCoolerController`), inte för vanliga styrenheter.

**Risk vid aktiv profil:** Om du manuellt ändrar en profilstyrd styrenhet via RAPT-appen (t.ex. till 22°C), accepterar synken det nya `target_temp`. Men vid nästa automationscykel ser PID att `profile_target_temp` fortfarande är 20°C och **korrigerar tillbaka** till PID-beräknat mål baserat på 20°C. Din manuella ändring "studsar" tillbaka inom ~5 minuter.

**Är detta önskat beteende?** Troligen ja — profilen "äger" målet. Men det kan vara förvirrande om man vill göra en tillfällig manuell override utan att stoppa profilen.

---

## Problem 3: full-sync-brew-data använder sin egen getRaptToken() utan cache

`full-sync-brew-data` har en **inlinad** `getRaptToken()` som alltid gör ett färskt auth-anrop — den läser inte `rapt_token_cache`. Den passerar sedan denna token till `sync-rapt-data` och `sync-rapt-data-quick`, men om token-hämtningen tar 20+ sekunder riskerar den att timeout:a.

**Risk:** Inte direkt instabilitet, men onödig latens. Full-sync borde använda cached token precis som quick-sync gör.

**Fix:** Byt ut den inlinade `getRaptToken()` i full-sync till att använda samma cache-strategi som quick-sync (läs från `rapt_token_cache` först).

---

## Observation A: Pass-through sync är effektivt död kod

I `controller-adjustments.ts` rad 186-192: pass-through kontrollerar `if (!fc.heating_enabled && !fc.cooling_enabled) continue` efter att redan ha skippat processerade kontroller. Men rad 291 i PID-loopen gör exakt samma check — varje controller med `heating_enabled || cooling_enabled` hanteras av PID. Så pass-through kan aldrig nå en controller som har aktiv kylning/värme.

**Risk:** Ingen direkt risk — koden gör rätt sak. Men om PID-processorn av någon anledning **inte** returnerar ett adjustment för en controller (t.ex. vid PWM lock), kommer pass-through **inte** att fånga upp den heller. Detta är dock korrekt beteende tack vare PWM-låsningslogiken.

---

## Observation B: Profilexekvering + PID kör på samma data men oberoende

`process-fermentation-profiles` och `auto-adjust-cooling` (PID) körs **parallellt** i `run-automation` (Steg 1+2). Profilen sätter `profile_target_temp` via `setProfileTarget()`. PID läser `profile_target_temp` för att beräkna kompensation. Om profilen avancerar till ett nytt steg under samma cykel:

1. Profilen skriver nytt `profile_target_temp` (t.ex. 20°C → 5°C cold crash)
2. PID kan ha redan läst det gamla värdet (20°C) och beräknat ett mål baserat på det

**Risk:** PID arbetar med det gamla profilvärdet i **en cykel** (~5 min). Nästa cykel ser den det nya värdet. Effekten är en enstaka cykel med "gammal" PID-kompensation, som snabbt korrigeras.

**Sannolikhet:** Sker vid varje stegtransition. Effekten är försumbar — max 5 minuters fördröjning.

---

## Slutsats

Det enda **riktiga** problemet att åtgärda är **Problem 3** (full-sync saknar token cache) för prestanda, och eventuellt **Problem 1** (concurrency overlap) för att helt eliminera risken för motstridiga RAPT API-anrop vid aktiv profil. Problem 2 är snarare en designfråga.

