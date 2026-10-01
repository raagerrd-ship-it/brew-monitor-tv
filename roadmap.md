# Roadmap

- [x] Polera bryggdagskortet (TV) i befintligt upplägg — måltemp som chip uppe till höger, "x av y klart"-räknare, tydligare status (klar/nästa/kommande) med NÄSTA-märke. Bara befintlig data; ingen extra timer. Verifierat i förhandsvisningen, bygget grönt.
- [x] Större texter i bryggdagskortet utan större kort (TV 16:9): stegtitel text-5xl, Mål text-4xl, namn/mängd/tid text-3xl/4xl — kompenserat med tätare padding/gap. Verifierat i 1280x720 TV-vy, bygget grönt.
- [x] Minska hack när bryggdagskortet glider in/ut på Chromecast: animera bara förflyttning, täckande TV-bakgrund utan tunga skuggor/blur, pausa andra animationer under växlingen. Kontrollerat i 1280x720 TV-vy.
- [ ] Sekventiell glidning: ölkorten glider klart först, sedan bryggdagskortet (och tvärtom vid stängning) så de inte tävlar om CPU på Chromecast.
