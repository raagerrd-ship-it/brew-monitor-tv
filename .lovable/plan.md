
Ja — jag har kollat internet och jämfört med vår kod. Plan:

1. Bekräftade riskfaktorer från internet
- Felvänd etikettrulle (termiska sidan fel) => "Feeding" utan tryck.
- För aggressiv BLE-sändning (stora chunkar / writeWithoutResponse) => data tappas.
- M110 behöver korrekt avslutningssekvens (footer), annars matning utan utskrift.
- Fel media-läge kan störa vissa modeller (vi skickar redan inte media-kommando).

2. Kodändringar jag föreslår
- `src/lib/thermal-printer.ts`
  - Tvinga `withResponse` som standard för M110-print (stabilitet före hastighet).
  - Byt failsafe-defaults till konservativa värden: `chunkSize=128`, `chunkDelay=20`, `throttleEvery=8`, `throttleDelay=80`.
  - Tvinga `sendFooter=true` i normal utskrift (kan inte stängas av av misstag).
  - Versionsstyr print-inställningar i localStorage och auto-resetta gamla/aggressiva profiler.
- `src/components/PrintLabelDialog.tsx`
  - Lägg till “Återställ till säkra utskriftsinställningar” som körs automatiskt första gången efter versionsbyte.
  - Begränsa/debug-skydda farliga reglage (footer/chunk/delay) så de inte påverkar normal användning.
  - Visa kort checklista före första BLE-utskrift: “etikettens printsida nedåt/höger”.

3. Verifieringsplan (end-to-end)
- Testa 5 utskrifter i rad med sparad skrivare (auto-anslut + print) utan “Feeding”-låsning.
- Testa med app omstart + ny session för att bekräfta att säkra defaults ligger kvar.
- Testa att debuginställningar inte kan lämna skrivaren i instabilt läge för nästa utskrift.
- Manuell hårdvarukontroll i samma flöde: rätt etikettvändning och tillräcklig batterinivå.

4. Tekniska detaljer
- Nuvarande kod kör `writeWithoutResponse` när möjligt och default `chunkSize=300` + `chunkDelay=5`; detta är aggressivare än vanliga stabila profiler i öppna implementationer (ofta 128/20).
- Officiell M110-felsökning anger uttryckligen att “feed but no print” ofta är felvänd etikett/printsida.
- Vi behåller att inte skicka media-kommando till skrivaren (för att inte ändra skrivarens permanenta mediaikon).
