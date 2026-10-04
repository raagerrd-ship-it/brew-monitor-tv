# Roadmap

- [ ] Verifiera paus, fortsätt, milstolpe och stopp på TV:n vid ett faktiskt timerförlopp. Start från Brew Master är bekräftad i timerdatan (Testtimer, push 4 okt 2026 kl. 13:24 svensk tid); övriga tillfällen har ännu inte observerats.

- [x] Rullande siffror i sidhuvudets temperaturer, statkortens huvudvärden och klockans timmar/minuter; statkortens value-shimmer ersatt. Verifiera i förhandsvisningen.

- [x] Polera bryggdagskortet (TV) i befintligt upplägg — måltemp som chip uppe till höger, "x av y klart"-räknare, tydligare status (klar/nästa/kommande) med NÄSTA-märke. Bara befintlig data; ingen extra timer. Verifierat i förhandsvisningen, bygget grönt.
- [x] Större texter i bryggdagskortet utan större kort (TV 16:9): stegtitel text-5xl, Mål text-4xl, namn/mängd/tid text-3xl/4xl — kompenserat med tätare padding/gap. Verifierat i 1280x720 TV-vy, bygget grönt.
- [x] Minska hack när bryggdagskortet glider in/ut på Chromecast: animera bara förflyttning, täckande TV-bakgrund utan tunga skuggor/blur, pausa andra animationer under växlingen. Kontrollerat i 1280x720 TV-vy.
- [x] Sekventiell glidning: ölkorten glider klart först, sedan bryggdagskortet (och tvärtom vid stängning) så de inte tävlar om CPU på Chromecast.
- [x] Lugna Sonos-bakgrunden: en aktiv inställningsrad, ljushet 70, mättnad 0,8, inbakad vinjett och ny cache.
- [x] Omslagets accentfärg i Sonos-detaljer och kortkanter, synkron med bakgrundsbyte.
- [x] Pulserande live-punkt på aktiva bryggders SG- och temperaturkurvor.
