
## Återställ 16:9 aspect ratio för desktop

### Problem
AspectRatioContainer beräknar korrekta 16:9-dimensioner för desktop men använder dem aldrig. Både desktop och TV renderar fullscreen utan aspect ratio-lock.

### Lösning
Separera desktop- och TV-renderingen i AspectRatioContainer:

- **Desktop**: Rendera en centrerad 16:9-box med letterboxing/pillarboxing (svarta kanter) baserat på de redan beräknade `dimensions`.
- **TV-läge**: Behåll nuvarande fullscreen `fixed inset-0` (TV:ar är redan 16:9).

### Teknisk ändring

**Fil: `src/components/AspectRatioContainer.tsx`**

Ändra return-blocket (rad 106-121) till att skilja på desktop och TV:

```text
Desktop (inte TV, inte mobil):
  - Använd de beräknade dimensions (width/height) för att skapa en centrerad container
  - Container begränsas till 16:9 med letterboxing/pillarboxing
  - Context får de beräknade dimensionerna och scale

TV-läge:
  - Behåll nuvarande fullscreen fixed inset-0
  - Context får tvDimensions (faktisk viewport)
```

Ingen ändring krävs för TV-läget eller mobil. Ingen påverkan på prestanda eller dataanvändning.
