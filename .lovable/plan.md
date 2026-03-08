

## Plan: Återställ "Synk-justering vid låtbyte" + ändra DB-default till 2.0

Två saker:
1. Återställ slidern i Settings och koppla tillbaka offset till tickern
2. Ändra kolumnens default från 0 till 2.0 i databasen

### Databasmigrering

```sql
ALTER TABLE sonos_settings ALTER COLUMN track_change_offset_seconds SET DEFAULT 2.0;
```

### Kodändringar

**1. `src/components/sonos/SonosSettings.tsx`**
- Lägg till state: `trackChangeOffset` (default 2.0)
- Läs `track_change_offset_seconds` i select-queryn (rad 52) och i loadSonosStatus
- Lägg till slider (0--5s, steg 0.5) i "Allmänna inställningar"-sektionen efter "Visa på dashboard"
- Auto-save via `saveField({ track_change_offset_seconds: value })`

**2. `src/components/sonos/hooks/useSonosInit.ts`**
- Lägg till `track_change_offset_seconds` i select-queryn (rad 24)
- Returnera `trackChangeOffsetMs` (värde * 1000, default 2000)

**3. `src/components/sonos/SonosWidget.tsx`**
- Destrukturera `trackChangeOffsetMs` från `useSonosInit`
- Skicka det som ny prop till `useSonosPlaybackTicker`

**4. `src/components/sonos/hooks/useSonosPlaybackTicker.ts`**
- Lägg till `trackChangeOffsetMs?: number` i params-interfacet
- Rad 101: ändra `const offsetMs = PREDICTIVE_MARGIN_MS` till `const offsetMs = trackChangeOffsetMs ?? PREDICTIVE_MARGIN_MS`

### Angående "förra låtens bakgrund visas"

Det beror troligen på att cachningen togs bort men `bg_image_url`/`next_bg_image_url` i `sonos_now_playing` fortfarande pekar på gamla filer. Nu när vi alltid regenererar borde nya synkar skriva över dessa URLs. Om problemet kvarstår efter nästa låtbyte kan vi felsöka vidare.

