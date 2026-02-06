

## Ta bort onödig CSS-blur från ölkorten

Ölkorten lägger på `backdrop-blur-md` via CSS när albumomslaget visas som bakgrund. Eftersom bakgrundsbilden redan är förbehandlad (blurrad och mörkad) på servern är detta onödigt och belastar GPU/CPU i onödan på TV-hårdvaran.

### Ändring

**`src/components/brew-card/BrewCard.tsx`** (rad 63-64)
- Ta bort den villkorliga `backdrop-blur-md`-klassen som läggs till när `hasAlbumArtBackground` är true
- Behåll `backdrop-blur-xl` som redan är villkorad till icke-TV-läge (rad 62)

Före:
```
${isTvMode ? '' : 'backdrop-blur-xl'} ${hasAlbumArtBackground ? 'backdrop-blur-md' : ''}
```

Efter:
```
${isTvMode ? '' : 'backdrop-blur-xl'}
```

Detta sparar GPU-cykler på Chromecast-hårdvaran utan visuell skillnad, eftersom bakgrundsbilden redan är suddig.

