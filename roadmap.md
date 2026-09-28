- [x] Behåll timerlisten som sidfot över hela bredden; gör aktuellt steg lättläst genom förenklat innehåll.

## Chromecast-granskning (Claude, 12 punkter)
- [x] 1 Förloppsstapel via transform, 2 ingen blur på TV + marquee 2 varv, 3 glödpuls av på TV, 4 decode + övertoning, 8 TV-nedsampling diagram, 11 SW registreras ej på TV, 12 flowId-läcka + splash avmonteras
- [x] 5 Alarmtimerns sekundtick i egen context
- [ ] 6 Delad pills/controllers-källa — ej klar: use-rapt-bar-data har fortfarande egen kanal/poll
- [x] 7 Stabil album-art-callback-context
- [ ] 9 En sync_settings-källa — ej klar: sync_settings har fortfarande tre kanaler
- [x] 10 Lazy-laddning av routes och utskrift/PDF-dialoger

## Klientoptimering (dataflöde/TV)
- [ ] 1 Ny mätpunkt läggs till utan loadBrews; inkrementell diagramhämtning; smalare sessionsfråga
- [ ] 2 Sonos-position från ankartid
- [ ] 3 Delad controllers/pills/pi_live_state-källa
- [ ] 4 Delad sync_settings-källa
- [ ] 5 Återhämtning vid visibilitychange/online
- [ ] 6 Död kod bort, testpaket till devDependencies
