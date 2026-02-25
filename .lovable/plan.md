

## Problem: Trend-bar visas inte i hastighetsvisualisering

### Orsak

Trend-baren i `FermentationRateBar` kräver att **både** `rate6h` och `rate12h` är icke-null och > 0 (rad 64). Om det saknas data i fönstret 6-12h sedan returnerar `calculateFermentationTrend` `rate12h: null`, och hela trend-baren försvinner.

Dessutom: om jäsningen är i stationär fas och båda raterna < 0.001 sätts trenden till "stable" men trend-barens bredd blir 0 (ingen visuell skillnad).

### Lösning

Två ändringar:

**1. `FermentationRateBar` (GravityStat.tsx)**
- Fallback: om `rate12h` saknas men `rate6h` finns, jämför `rate6h` mot 24h-raten (`rate` parametern) istället
- Detta ger en trend-visualisering även utan fullständig 12h-data

**2. `calculateFermentationTrend` (brew-utils.ts)**  
- Sänk tröskeln för trend-detektering från 0.001 till 0.0005 så att trend visas även i långsammare faser
- Om `rate12h` är null men `rate6h` finns, returnera en jämförelse mot 24h-raten som fallback

### Tekniska detaljer

```text
Nuvarande flöde:
rate6h=null OR rate12h=null → trendBarWidth=0 → ingen trend visas

Nytt flöde:
rate6h finns + rate12h=null → fallback till rate vs rate6h
rate6h finns + rate12h finns → befintlig logik (oförändrad)
```

Ändringen i `FermentationRateBar`:
- Rad 62-68: Lägg till fallback som beräknar `previousPct` baserat på 24h-raten när `rate12h` saknas
- Behåll befintlig logik när båda finns

Ändringen i `calculateFermentationTrend`:
- Rad 267: Sänk `> 0.001` till `> 0.0005` för att fånga upp subtilare trender
- Rad 272-273: När `rate12h` är null, beräkna trend baserat på om `rate6h` avviker >30% från 24h-medelvärdet (detta kräver att vi skickar 24h-raten som referens, men det behöver inte ändras i funktionssignaturen eftersom `FermentationRateBar` redan har tillgång till `rate`)

### Påverkade filer
- `src/components/brew-card/GravityStat.tsx` - Fallback-logik i `FermentationRateBar`
- `src/lib/brew-utils.ts` - Lägre tröskel för trend-detektering

