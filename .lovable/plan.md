
# Samverkan mellan fermenteringsprofil och overshoot-skydd

## Problemet idag
Två system slåss om temperaturen:
1. **Fermenteringsprofilen** enforce:ar 22°C varje cykel (var 5:e minut)
2. **Overshoot-skyddet** sänker till ex. 20°C när pill-temp visar att ytan kokar

Resultatet blir att profilen omedelbart skriver tillbaka 22°C, och overshoot-skyddet aldrig hinner verka.

Att helt skippa overshoot (nuvarande lösning) innebär att pill kan vara 6°C över target utan att systemet reagerar.

## Lösning: Profilen sätter mål, overshoot får agera under det

Strategin är enkel:
- Overshoot-skyddet ska fortsätta fungera precis som vanligt, även för profilstyrda tanks
- Fermenteringsprofilen ska INTE tvinga tillbaka temperaturen om overshoot nyligen har sänkt den
- Profilen definierar "original target" som overshoot räknar utifrån

## Tekniska ändringar

### 1. `auto-adjust-cooling/index.ts` -- Ta bort PROFILE_SKIP för overshoot
- Ta bort raden som skippar overshoot för profilstyrda controllers (`OVERSHOOT_PROFILE_SKIP`)
- Behåll `STALL_PROFILE_SKIP` (stall-boost ska fortfarande inte köras på profilstyrda tanks, profilen hanterar det)
- Overshoot-logiken använder redan `originalTarget` från `original_target_temp`-kolumnen, som profilen sätter -- detta fungerar redan korrekt

### 2. `process-fermentation-profiles/index.ts` -- Respektera overshoot-sänkningar
- I den nya "enforce effective target"-logiken: innan vi tvingar tillbaka temperaturen, kolla om det finns en nylig overshoot-justering (senaste 15 minuter) för denna controller
- Om overshoot nyligen har sänkt temperaturen, skippa enforce och låt overshoot verka
- Om ingen nylig overshoot finns (dvs recovery har redan skett eller det gått tillräckligt lång tid), enforce:a som vanligt

Konkret:
```
// Pseudokod för process-fermentation-profiles
if (currentStep.target_temp === null && controller) {
  const effectiveTarget = getEffectiveTargetTemp(steps, index)
  if (effectiveTarget && controller.target_temp < effectiveTarget) {
    // Temp är LÄGRE än profilen vill ha -- kolla om overshoot sänkt den
    const recentOvershoot = await checkRecentOvershootAdjustment(controllerId, 15 min)
    if (recentOvershoot) {
      console.log("Overshoot aktiv, låter den verka")
      // Skippa enforce
    } else {
      // Ingen aktiv overshoot, enforce profil-target
      setControllerTargetTemp(controllerId, effectiveTarget)
    }
  }
}
```

### 3. Säkerställ att `original_target_temp` sätts korrekt
- Verifiera att `original_target_temp` i `rapt_temp_controllers`-tabellen reflekterar profilens mål-temperatur (22°C), inte den sänkta overshoot-temperaturen
- Profilen ska sätta `original_target_temp` till profilens effective target vid steg-start, så overshoot vet vad "normal" är

## Sammanfattning av flödet efter ändringarna

```text
Sync-cykel var 5:e minut:
                                                  
  1. process-fermentation-profiles               
     - Profil säger 22°C                          
     - Controller är på 20°C                      
     - Kolla: finns nylig overshoot-justering?     
       JA  -> Skippa, overshoot hanterar det       
       NEJ -> Enforce 22°C                         
                                                  
  2. auto-adjust-cooling (overshoot)              
     - Pill = 28°C, target = 22°C                 
     - Overshoot detekterad!                       
     - Sänk till midpoint: ~20°C                  
     - Overshoot recovery höjer tillbaka           
       gradvis när pill sjunker                    
```

## Resultat
- Pill-temp 6°C över target triggar fortfarande overshoot-skydd
- Profilen skriver inte över overshoot-sänkningar
- När overshoot-skyddet har recoverat tillbaka till target, tar profilen vid igen
- Stall-boost körs fortfarande inte på profilstyrda tanks (profilen hanterar temperaturhöjningar)
