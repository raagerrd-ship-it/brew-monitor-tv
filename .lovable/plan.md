

# Fixa samverkan fermenteringsprofil + overshoot + bugg

## Akuta problem

### 1. Krasch-bugg (kritisk)
`process-fermentation-profiles` kraschar **varje cykel** med `ReferenceError: Cannot access 'actionTaken' before initialization`. Orsaken: den nya enforce-logiken (rad 264-307) refererar till `actionTaken` och `actionDetails` INNAN de deklareras (rad 258-260). Funktionen lyckas ändå skicka API-anropet till RAPT (sätter 22C) men kraschar innan den hinner:
- Uppdatera databasen med den nya temperaturen
- Logga aktionen
- Returnera resultat

Det betyder att controllern sätts till 22C via RAPT API, men databasen fortfarande visar 19.7C. Nästa sync skriver över med 19.7C igen.

### 2. Ping-pong-loop
Även efter buggfixen: profilen enforce:ar 22C, men overshoot ser att pill (24.3C) ar over target (22C) + threshold och sanker tillbaka. Profilen har ingen overshoot-historik att checka (vi rensade tabellen, och buggen hindrar insert) sa den enforce:ar igen. Oandlig loop.

### 3. Grundproblemet: overshoot ar fel verktyg for jasningsvärme
Overshoot-skyddet ar designat for att motverka att en HEATER overdriver. Men under aktiv jasning ar det biologisk varme som gor att pill-temp ar hogre an controller-temp. Att sanka target gor ingenting for att minska jasningsvärme — det kan till och med gora det varre genom att kyla for aggressivt.

## Losning

### Steg 1: Fixa kraschen
Flytta enforce-logiken SA att den kors EFTER deklarationen av `actionTaken`/`actionDetails` (rad 258-260). Alternativt flytta variabeldeklarationerna uppat.

### Steg 2: Overshoot ska inte motverka profilen
Nar overshoot agerar pa en profil-styrd controller, maste resultatet sparas i `auto_cooling_adjustments` (som det redan gor). Profilen maste sedan respektera denna justering genom att INTE enforce:a tillbaka under 15 minuter. Den logiken finns redan (rad 268-279), men fungerar inte pga:
- Kraschen forhindrar att vi nar dit pa ett stabilt satt
- `auto_cooling_adjustments` ar tom (vi rensade den)

Nar buggen ar fixad borde flödet bli:
1. Profilen enforce:ar 22C, sparar adjustment
2. Overshoot ser pill over threshold, sanker till ~20C, sparar adjustment
3. Nasta cykel: profilen ser recent overshoot, SKIPPAR enforce
4. Overshoot recovery hojer gradvis tillbaka nar pill sjunker
5. Nar 15 min gaett utan ny overshoot, profilen enforce:ar 22C igen

### Steg 3: Intelligent overshoot-anpassning for profil-tankar
Overshoot-logiken bor ta hansyn till att pill-delta under jasning ar NORMALT och inte overshoot. Tva alternativ:

**Alternativ A (rekommenderat)**: Hoj overshoot-troskeln for profil-styrda controllers. Istallet for `pill > target + 0.3` (overshoot_pill_threshold), anvand en dynamisk troskel baserad pa jasningsaktivitet: om SG-raten visar aktiv jasning, tolerera hogre pill-delta (t.ex. +3C istallet for +0.3C).

**Alternativ B**: Lat profilen satta `original_target_temp` i `rapt_temp_controllers`-tabellen, sa att overshoot vet vad "normalt" ar och kan rakna mot det.

## Teknisk implementering

### `process-fermentation-profiles/index.ts`
- Flytta deklarationen av `actionTaken`, `actionDetails`, `stepCompleted` FORE enforce-logiken (rad 258 -> 261)
- Alternativt: flytta hela enforce-blocket EFTER deklarationerna
- Laga overshoot-check: den nuvarande koden fungerar men kraver att adjustments-tabellen har data

### `auto-adjust-cooling/index.ts`
- I overshoot-sektionen: for profil-agda controllers, anvand en hogre pill-troskel (t.ex. originalTarget + 3.0C istallet for + 0.3C) for att tolerera jasningsvärme
- Behall overshoot-skydd for extrema fall (pill > target + 5C) dar nagot verkligen ar fel
- Overshoot recovery behover ingen andring — den fungerar redan korrekt

### Deployment
- Deploya bada edge functions
- Rensa INTE adjustment-tabellen — den behovs for att profilen ska kunna se overshoot-historik
