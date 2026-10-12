# Roadmap

- [ ] Lägg fasvakt (varaktighet + 1500 ms) för bryggdagens in/ut; testa utan transitionend och skicka sparade mätningar för 1/2 ölkort. Ingen publicering.

- [x] Mät bryggdagsglidning in/ut med 1/2 ölkort och CPU ×6: behåll förberett höjdbyte, sekventiella glidningar och fryst nedräkning; återställ skuggförsök och tillfälligt will-change efter fler långa bildrutor. 21 tester och automatiskt bygge gröna; förberedelsen har fortfarande långa bildrutor. Inga testrader eller publicering.

- [x] Bryggdagens TV-layout: toppjusterad lista, tydligt Nästa-fält, hela målgrader, 0/3 ölkort, korrekt footer och glesade tidslinjeetiketter. Verifierat i 1920×1080 med mockade svar och blockerade pushanrop; 19 tester och automatiskt bygge gröna. Tre ölkort ritas rent med bryggdagen på 1/3; långt tillsatsnamn förkortas fortfarande. Inga testrader eller publicering.

- [x] Bryggdag: TV larmar själv vid förfallna milstolpar, steg/Nästa på kortet, gemensam timer för kort och footer, KLART på kortet, "pågått" för steg utan tid. Verifierat i 1920×1080 TV-vy, ej publicerat.

- [x] Sonos-header: mät text efter bredd/fontändringar, rätta låtlängd och positionsstart. Fyra tester gröna; kort/lång text och riktigt låtbyte verifierade i 1920×1080 TV-vy, bygge grönt, ej publicerat.

- [x] TV-optimering enligt prioriteringslistan (live-ring som HTML, sidhuvudets mål-fel, diagramdata, omritningar, pollning, lättare siffror, småpunkter). Före/efter mätt i TV-vy.

- [x] Minska hack när rengöringskorten visas och döljs på TV: synka båda glidytorna och förenkla den rörliga ytan. In/ut verifierat i TV-vy utan sidfel; faktisk Chromecast återstår att känna av.

- [x] Klockan: ett steg per ändrad siffra, även 5→0 och 23→00; datavärden behåller remsan. Verifierat i förhandsvisningen.
- [x] Ta bort inställningen för den borttagna timerfunktionen. Kontrollera konfigurationen.

- [x] Verifiera paus, fortsätt och milstolpe var för sig vid ett faktiskt timerförlopp. Bekräftat av användaren 4 okt 2026 — alla fem tillfällen (start, paus, fortsätt, milstolpe, stopp) når TV:n via receive-timer.

- [x] Rullande siffror i sidhuvudets temperaturer, statkortens huvudvärden och klockans timmar/minuter; statkortens value-shimmer ersatt. Verifiera i förhandsvisningen.

- [x] Polera bryggdagskortet (TV) i befintligt upplägg — måltemp som chip uppe till höger, "x av y klart"-räknare, tydligare status (klar/nästa/kommande) med NÄSTA-märke. Bara befintlig data; ingen extra timer. Verifierat i förhandsvisningen, bygget grönt.
- [x] Större texter i bryggdagskortet utan större kort (TV 16:9): stegtitel text-5xl, Mål text-4xl, namn/mängd/tid text-3xl/4xl — kompenserat med tätare padding/gap. Verifierat i 1280x720 TV-vy, bygget grönt.
- [x] Minska hack när bryggdagskortet glider in/ut på Chromecast: animera bara förflyttning, täckande TV-bakgrund utan tunga skuggor/blur, pausa andra animationer under växlingen. Kontrollerat i 1280x720 TV-vy.
- [x] Sekventiell glidning: ölkorten glider klart först, sedan bryggdagskortet (och tvärtom vid stängning) så de inte tävlar om CPU på Chromecast.
- [x] Lugna Sonos-bakgrunden: en aktiv inställningsrad, ljushet 70, mättnad 0,8, inbakad vinjett och ny cache.
- [x] Omslagets accentfärg i Sonos-detaljer och kortkanter, synkron med bakgrundsbyte.
- [x] Pulserande live-punkt på aktiva bryggders SG- och temperaturkurvor.
- [x] Händelseprickar i diagrammen med vertikalt läst förklaringstext ovanför pricken, jäst/pitch inkluderad.
- [ ] TV-kortet visar steg/delfas/framsteg rakt ur Pi:ns step_phases (kontrakt v26): nya fält step_name/step_count i brew_status, stegstatus var 60:e s, badge "Steg x/y · namn", aktiv fas label+villkor, en overlay för h/%, fallback oförändrad utan step_phases. Verifierad med Pi:ns riktiga fasdata i TV-vyn. Öppen: kortet når inte faserna — useStepPhases slår på source_id men sessionens brew_id = pi_brew_id (b696512e vs 67346f28).
- [x] Kontrakt v27: klar-tid från Pi:ns condition.ends_at/remaining_h (UTC) i stället för egen uträkning, alltid svensk tid, dag med vid >1 dygn ("klart ons 08:10"). Verifierat i TV-vyn: "3,3 av 12 h · klart ca 20:09".
- [ ] AI-funktion med Claude (användaren bad om det; väntar på val av typ — skrivskyddad, ingen styrning av Pi:n).

