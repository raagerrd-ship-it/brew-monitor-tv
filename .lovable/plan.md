

# Jäsningsfarts-mätare i Gravity-kortet

Ersätter texten "-0.012/dygn" med en visuell hastighetsmätare (bar) som visar aktuell jäsningsfart, stall-zon och trend.

## Koncept

```text
Gravity-progress (befintlig):
[████████████████░░░░░░] 72%
 1.052              1.010

Jäsningsfart (ny):
[▓▓▓▓▓|████████░░░░░░░░░] ▶ 0.008/d
 STALL         0.015
  ^rödzon  ^aktuell  ^skala
      trendpil (▲ ökar / ▼ bromsar / ▶ stabil)
```

Baren visar:
- **Rödzon** (0 till stall-tröskeln, t.ex. 0.002) -- gradient röd till orange
- **Aktuell fart** som en markör/linje på baren
- **Trendpil** som visar om farten ökar, minskar eller är stabil (beräknas genom att jämföra farten senaste 6h mot föregående 6h)
- Döljs för inaktiva bryggningar (Konditionering/Klar), samma som idag

## Teknisk plan

### 1. Beräkna trend i `brew-utils.ts`

Ny funktion `calculateFermentationTrend(sgData)` som returnerar `{ rate6h: number | null, rate12h: number | null, trend: 'rising' | 'falling' | 'stable' | null }`.

- Beräknar farten för senaste 6h separat och senaste 6-12h separat
- Om senaste 6h-farten ar mer an 20% snabbare an foregaende period: `rising`
- Om mer an 20% långsammare: `falling`
- Annars: `stable`

### 2. Utoka BrewData-typen

Lägg till `fermentationTrend` (optional) i `BrewData`-interfacet i `src/types/brew.ts`.

### 3. Populera trenden i `use-brew-data.ts`

Anropa `calculateFermentationTrend()` och sätt på BrewData-objektet, på samma ställen som `fermentationRate` beräknas.

### 4. Uppdatera `GravityStat.tsx`

Ersätt text-raden (rad 99-111) med en visuell bar-komponent:

- **Skala**: 0 till `maxRate` (dynamiskt, t.ex. `Math.max(0.015, rate * 1.5)`)
- **Stall-zon**: Röd gradient från 0 till stallThreshold (hårdkodat 0.002 som default, eller hämtat från settings)
- **Fart-markör**: Vertikal linje/punkt på rätt position
- **Trendindikator**: Liten pil (▲/▼/▶) bredvid värdet
- **Labels**: "STALL" vänster, aktuellt värde höger
- Samma stilspråk som befintliga progress-baren ovanför (mörk bakgrund, glöd-effekt)

### 5. Stall-tröskel

Hårdkoda ett default-värde (0.002) i frontend. Tröskeln finns redan i backend-inställningar men behöver inte hämtas -- det visuella är ett ungefärligt mått.

### Filer som ändras

| Fil | Ändring |
|-----|---------|
| `src/lib/brew-utils.ts` | Ny funktion `calculateFermentationTrend()` |
| `src/types/brew.ts` | Nytt fält `fermentationTrend` på `BrewData` |
| `src/hooks/use-brew-data.ts` | Beräkna och populera `fermentationTrend` |
| `src/pages/Brew.tsx` | Beräkna och populera `fermentationTrend` (delad vy) |
| `src/components/brew-card/GravityStat.tsx` | Ersätt textrad med visuell fartmätare |

