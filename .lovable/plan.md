# Fjärrstyrning från mobilen — minsta möjliga, Pi:n är master

Molnet skickar avsikt, Pi:n verkställer. Inga nya kommandokanaler: `target_temp` och `enabled` i `pi_setpoint` är hela styrytan, plus en tidsstämpel på knapptrycket.

## Databas

- `pi_setpoint.target_temp` är i dag **NOT NULL** — måste släppas till nullbar, annars går det inte att lämna manuellt läge på distans.
- `pi_setpoint.commanded_at timestamptz null` — ny.
- `pi_live_state.target_source text null` — ny.
- `pi_live_state.effective_target numeric null` — ny (finns inte i dag; `target_temp` finns men betyder något annat).

Inga andra kolumner. Inget `manual_target_temp`, inget `profile_paused`.

## Moln → Pi (`pi-control`)

Setpoint-svaret (både listan och enkelvarianten) får:

- `target_temp` som `number | null` — i dag kastas värdet alltid till float, vilket gör null till `NaN`. Fixas så null skickas som äkta null.
- `commanded_at` — nytt fält, rakt från kolumnen.

Utelämnat fält = ingen ändring. `null` = rensa. Den skillnaden är hela poängen.

## Pi → moln (`pi-telemetry`)

Tar emot `target_source`, `effective_target` och `paused_at` i både live och rollup och skriver dem till `pi_live_state`. Samma regel som redan gäller i funktionen: fält som saknas lämnas orörda, null rensar. Bara Pi:n skriver dem.

`paused_at` är Pi:ns egen tidsstämpel för när profilen pausades. Utan den kan appen bara räkna från när *den* såg `target_source` bli `manual`, vilket börjar om vid omladdning och nätavbrott — samma buggklass som TV:n som inte rensade efter avslutad profil.

Prioritet i visningen: `off` vinner över `manual`. Är tanken avstängd med ett manuellt mål satt är källan `off`. Pi:n avgör, appen visar bara.

## Frontend

### Tankkortet (TV + mobil)

- **Ålder på mätvärdet** bredvid temperaturen: "2 min sedan" normalt, markerad över 5 min, och över 15 min visas själva temperaturen som opålitlig (dämpad + varningsmarkering).

### Override i profilrutan (TV)

När `target_source` inte är `profile` tar jäsprofilrutan över som overridemarkör — samma yta som redan drar blicken, inget nytt element:

- Rutan byter färg från profilgrönt till bärnsten (manuellt) respektive dämpat rött (AV), med markerad ram.
- Rubriken byts från stegnamnet till **"MANUELLT 6,5°"** eller **"AVSTÄNGD"**, i samma storlek som stegetiketten så det är läsbart från soffan.
- Under rubriken, mindre text: vilket profilsteg som är pausat och hur länge overriden varit aktiv ("Pausad: Diacetylvila · 25 min"). Stegets progress fryser visuellt i stället för att fortsätta räkna.
- Kör ingen profil alls visas bara "MANUELLT 6,5°" / "AVSTÄNGD" utan pausrad.
- Rutan är ren statusvisning på TV — alla ändringar sker från mobilpanelen.

Pausdurationen räknas från `paused_at` i telemetrin, inte från när appen först såg overriden.

### Kontrollpanelen (mobil)

Ett tryck på tankkortet öppnar en bottom sheet (Sheet på mobil, befintlig dialog på desktop/TV).

Läsning överst: aktuell temp, effektivt mål, källa, ålder.

Tre åtgärder:

- **Måltemperatur** — ± i steg om 0,1° med separat **Sätt**-knapp. Ingen skrivning på ±, bara på Sätt.
- **Släpp till profil** — visas bara när `target_source == "manual"`. Skriver `target_temp: null`.
- **Stäng av / Slå på** — skriver `enabled`. Avstängning kräver bekräftelsedialog som namnger tanken: *"Stäng av Blå (Skogens Sus)? Jäsprofilen pausas tills du slår på igen."*

Alla tre sätter `commanded_at` till knapptryckets tidpunkt.

På TV-bredd renderas panelen som ren läsning, utan knappar.

### Kvittens

Ingen tillståndsmaskin. Efter skrivning visas "Skickat 14:32" under panelen. Statusraden fortsätter visa `target_source` och `effective_target` från telemetrin — det är kvittensen. Har det gått mer än två minuter utan att de matchar det som skickades visas en diskret rad "Pi:n har inte bekräftat ännu". Blockerar inget.

## Filer som berörs

- migration: kolumnändringarna ovan (inkl. `pi_live_state.paused_at`)
- `supabase/functions/pi-control/index.ts` — nullbar `target_temp`, `commanded_at` i svaret
- `supabase/functions/pi-telemetry/index.ts` — ta emot och skriva `target_source`, `effective_target`, `paused_at`
- `src/hooks/use-controller-dialog.ts` — läsa nya fälten, realtidsprenumeration, skrivfunktioner (sätt mål / släpp / på-av) med `commanded_at`
- `src/components/RaptControllerDialog.tsx` — panelen, bekräftelsedialogen, mobil bottom sheet, "Skickat"-raden
- `src/components/brew-card/TempStat.tsx` — ålder på mätvärdet
- `src/components/fermentation/FermentationSessionCompact.tsx`, `FermentationSessionMinimal.tsx`, `sessionStyles.ts` — overridevisning i profilrutan
- `src/components/PiTankSettings.tsx` — på/av **tas bort** här (panelen äger den, med bekräftelse); lägesväljaren blir kvar och trestegskvittensen ersätts av samma källbaserade status

## Acceptanskriterier

1. Manuellt mål från mobilen → effektivt mål ändras inom 30 s → kortet visar "Manuellt X°"
2. Släpp → `target_source` blir `profile` igen och målet blir profilstegets
3. Samma tal som redan visas verkställs ändå (`commanded_at` gör skillnaden)
4. Avstängning kräver bekräftelse med tankens namn
5. Utan nät: åldern stiger i appen, inget dubbelverkställs när nätet kommer tillbaka
6. Ingen ny kolumn i `pi_setpoint` utöver `commanded_at`
7. Byte av läge (t.ex. "både" → "bara kyla") ändrar inte målet och pausar inte profilen
8. Pausduration och fryst progress överlever omladdning och nätavbrott (räknas från `paused_at`)

## Databas, tillägg

- `pi_live_state.paused_at timestamptz null`

## Pi-sidan (utanför den här appen)

Fyra saker, varav en är en befintlig bugg oavsett den här ändringen:

1. **Per-fält-fingeravtryck** i stället för ett gemensamt `(target_temp, enabled, mode_allowed)`. I dag skriver ett lägesbyte in molnets gamla `target_temp` som manuell override och pausar profilen tyst. `target_temp` färsk vid ändrat `(värde, commanded_at)`, `enabled` och `mode_allowed` färska bara vid ändrat värde — och `mode_allowed` rör aldrig overriden.
2. `target_temp: null` rensar den lokala overriden.
3. `target_source` + `effective_target` i telemetrin, med `off` före `manual`.
4. `session.paused_at` i telemetrin.
