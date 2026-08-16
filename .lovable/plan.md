# Fjärrkontroll för Pi-styrda tankar

Pi:n förblir master. Molnet skickar bara *avsikt* — Pi:n avgör om och när den verkställer, och kvitterar tillbaka. Om nätet ligger nere händer ingenting: senaste kvitterade läget gäller.

## Tre kommandon

1. **Pausa/återuppta profil** — profilsteget fryser (timer stannar), måltemperaturen står kvar på det steget hade.
2. **Manuellt mål** — sätter en fast temperatur. Pausar automatiskt profilen (ditt val), så det finns aldrig två källor som slåss om målet. Att släppa manuellt läge återupptar profilen.
3. **Läge kyla/värme/auto/av** — finns redan i Inställningar, flyttas in i samma panel så alla tre sitter ihop.

Inga timeouts: ett kommando gäller tills du ändrar det.

## Var det syns

I controller-dialogen (klick på tanken). Ny sektion "Fjärrstyrning" med:

- Paus-knapp (visas bara när en profil kör), med steg-etikett
- Manuellt mål: +/- i 0,1° med Sätt/Släpp-knapp
- Lägesväljare (auto / bara kyla / bara värme / av)
- Kvittensrad per kommando: *Skickat → Väntar på Pi → Kvitterad av Pi*, samma mönster som PiTankSettings redan använder (jämför `set_at` mot `last_heartbeat` + echo-fält)

Dashboardkortet får en liten diskret indikator när tanken står i manuellt läge eller pausad profil, så det syns på TV:n utan att lägga till knappar där.

## Teknisk del

**Databas** — nya kolumner:

- `pi_setpoint.profile_paused boolean not null default false`
- `pi_setpoint.manual_target_temp numeric null` (null = profilen/normal styrning äger målet)
- `pi_live_state.profile_paused boolean null` och `pi_live_state.manual_target_temp numeric null` — Pi:ns echo, används enbart för kvittens

**pi-control** — lägg `profile_paused` och `manual_target_temp` i setpoint-svaret (både list- och enkelvarianten). Inga andra fält ändras.

**pi-telemetry** — ta emot `profile_paused` och `manual_target_temp` i live/rollup och skriva dem till `pi_live_state`. Följer samma null-regler som redan gäller: fältet saknas = lämna orört, null = rensa.

**Frontend**

- `src/components/RaptControllerDialog.tsx`: ny sektion, skriver till `pi_setpoint` (sätta manuellt mål sätter samtidigt `profile_paused = true`; släppa sätter båda tillbaka).
- `src/hooks/use-controller-dialog.ts`: läs och realtidsprenumerera på de nya fälten för kvittens.
- `src/components/PiTankSettings.tsx`: oförändrad funktion, men visar pausad/manuell status.

**Vad Pi:n behöver göra** (utanför den här appen, sammanfattas som en formulering att skicka vidare): läsa de två nya fälten i setpoint-pollen, frysa stegtimern när `profile_paused` är true, använda `manual_target_temp` som mål när det inte är null, och eka tillbaka båda i telemetrin.
