# Roadmap

- [ ] Klockan: ett steg per ändrad siffra, även 5→0 och 23→00; datavärden behåller remsan. Verifiera i förhandsvisningen.
- [ ] Ta bort inställningen för den borttagna timerfunktionen. Kontrollera konfigurationen.

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

