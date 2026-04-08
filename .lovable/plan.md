
Mål

- Göra dödbandet till en håll-zon, inte en avstängnings-zon.
- Låta `ssFloor` vara den duty som faktiskt håller exakt måltemp trots termisk tröghet.
- Sluta “tappa” steady duty precis när systemet når målet.

Vad jag ser i koden nu

- I `supabase/functions/_shared/pid-compensation.ts` används `ssFloor` redan inne i deadband (`|error| <= 0.10`).
- Problemet är precis efter det: grenen `mild-overshoot` sätter `dutyCycle = 0` så fort man hamnar lite på “fel sida” om målet.
- I `supabase/functions/_shared/controller-adjustments.ts` blockeras dessutom `ssFloor`-inlärning under `deadband-recovery`, alltså just när regulatorn försöker hitta tillbaka till golvet.

Det är därför beteendet känns motsägelsefullt: `ssFloor` finns för att hålla målet, men logiken klipper bort den för tidigt.

Plan

1. Ändra PID-beteendet nära målet i `pid-compensation.ts`
- Behåll deadband, men definiera det som “target hold”.
- När ett etablerat `ssFloor` finns ska regulatorn fortsätta hålla samma mode nära målet i stället för att falla till 0%.
- Ersätt dagens “mild overshoot = duty 0%” med en mjuk håll-logik nära målet:
  - håll minst floor eller en försiktigt trimmad floor i samma mode
  - börja först nolla/erodera tydligt när översvängen är verklig, inte bara några hundradelar över/under målet
- Behåll aggressiv erosion först vid riktig overshoot, inte vid normal target-passering med tröghet.

2. Låt `ssFloor` lära sig när den faktiskt håller målet i `controller-adjustments.ts`
- Uppdatera lärvillkoren så att `ssFloor` får läras även under hold/recovery/catchup nära målet, inte bara i “ren deadband utan recovery”.
- Fortsätt använda mode-specifika nycklar (`steady_state_duty:cooling:*`, `steady_state_duty:heating:*`).
- Behåll separat nedlärning vid verklig overshoot så att för höga golv fortfarande kan korrigeras ned.

3. Behåll skydd som redan är rätt
- `MODE_FLOOR_BLOCK` ska vara kvar: har man ett etablerat värmegolv ska den inte börja kyla, och tvärtom.
- Marginalskalning för kyla kan lämnas som den är.
- Ingen databasmigration behövs.

Tekniska detaljer

- Filer: främst
  - `supabase/functions/_shared/pid-compensation.ts`
  - `supabase/functions/_shared/controller-adjustments.ts`
- Ny loggning/constraints bör tydligt skilja på:
  - target hold
  - recovery/catchup
  - verklig overshoot-erosion
- Jag skulle inte ta bort dödbandet helt; jag skulle ändra dess betydelse från “lugnt område där duty kan dö ut” till “område där `ssFloor` aktivt håller setpoint”.

Verifiering efter implementation

- Kontrollera Blå på hold-target: duty ska ligga kvar aktiv runt exakt mål i stället för att falla till 0 när den precis passerar målet.
- Kontrollera Grön i heating: samma princip fast spegelvänt, ingen kylstart om värmegolv finns.
- Bekräfta att `ssFloor` fortsätter lära uppåt/nedåt medan systemet faktiskt håller måltemp.
- Bekräfta att riktig overshoot fortfarande kan sänka ett för högt floor och att regulatorn inte fastnar i konstant överstyrning.
