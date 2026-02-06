

## Öka blur kraftigt på albumomslag-bakgrunden

Bakgrunden ser knappt suddig ut på TV:n. Ökar blur-parametrarna markant.

### Ändring

**`supabase/functions/prepare-album-background/index.ts`**

Ändra blur från `(50, 25)` till `(80, 40)` — en kraftig ökning:

```
// Före
img.blur(50, 25);

// Efter
img.blur(80, 40);
```

### Efterarbete
- Deploya funktionen
- Cachade bilder i `album-backgrounds`-bucketen måste rensas så nya genereras med den kraftigare blurren

