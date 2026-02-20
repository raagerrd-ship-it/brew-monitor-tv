

## Rensa upp temperaturkortet

Problemet: Temperaturkortet visar just nu huvudtemperatur (snitt), plus en rad med "C:13.4  M:14.0  P:14.6" i liten text, plus span-baren -- allt packat i ett litet kort.

### Losning

Flytta bort den textbaserade sensorrad ("C:... M:... P:...") fran kortet helt. Span-baren visar redan visuellt var controller (bla), pill (gron) och mal (orange markorer) ligger relativt varandra. Detaljerna finns redan i tooltip nar man hovrar pa span-baren.

Resultat:
- **Label**: "Temp" (eller "Temp (M:14.0)" om det finns ett mal)
- **Varde**: Snittemperaturen i stort, t.ex. "14.0 grader"
- **Sub-value**: Borttaget (inget mer C/M/P-text)
- **Span-bar**: Kvar i botten -- ger visuell info om spridningen
- **Tooltip**: Alla detaljer tillgangliga via hover pa span-baren (controller, pill, delta, mal, kompenserat mal)

### Tekniska detaljer

**Fil: `src/components/brew-card/TempStat.tsx`**

1. Ta bort `sensorSubValue`-variabeln (raderna som bygger `<span>C:... M:... P:...</span>`)
2. Uppdatera `label` sa att den alltid visar "Temp" -- med profilmal i parentes om det finns, t.ex. "Temp (M:14.0)"
3. Satt `subValue={null}` pa StatCard istallet for `subValue={sensorSubValue}`
4. Behall span-baren och tooltip-funktionaliteten oforandrad

Detta gor kortet mycket renare -- en tydlig etikett, ett stort varde, och en visuell span-bar som man kan hovra pa for detaljer.

