

# Chromecast-optimering: Ta bort GPU-tunga operationer

## Sammanfattning
Koden har fortfarande flera CSS-effekter som belastar GPU:n pa Chromecast. Alla transitions, blurs och shadows ska bort i TV-mode. Album art visas direkt (opacity 0 eller 1, ingen fade).

## Andringar

### 1. SonosWidget.tsx - Ta bort transitions och skuggor i TV-mode

- **Album art img**: Ta bort `transition: 'opacity 600ms ease-out'` och `willChange`. Anvand `opacity: imageLoaded ? 1 : 0` utan transition (omedelbar visning).
- **Text**: Ta bort `drop-shadow-lg` och `drop-shadow-md` i TV-mode. Texten ar vit mot mork bakgrund, skugga behovs inte.
- **Widget-container**: Ta bort `animate-fade-in` i TV-mode.
- **Progressbar**: Ta bort `transition: 'width 300ms linear'` i TV-mode. Vid 1-3 fps syns transitions anda inte.

### 2. BrewingDashboard.tsx - Ta bort backdropFilter och transition

- **Header** (rad 277-284): Ta bort `backdropFilter: 'blur(12px)'` helt i TV-mode. Blur ar extremt GPU-tung. Anvand en solid bakgrund med hogre opacitet istallet (t.ex. `hsl(222 20% 9% / 0.85)`).
- **Header**: Ta bort `transition-all duration-500` i TV-mode.

### Teknisk sammanfattning

| Vad | Problem | Atgard |
|-----|---------|--------|
| Album art opacity | 600ms CSS transition + willChange | Omedelbar (ingen transition) i TV-mode |
| Text drop-shadow | GPU filter | Ta bort i TV-mode |
| Widget animate-fade-in | CSS animation | Ta bort i TV-mode |
| Progress bar transition | 300ms CSS transition | Ta bort i TV-mode |
| Header backdropFilter blur | Extremt GPU-tung | Solid bakgrund i TV-mode |
| Header transition-all | Onodig transition | Ta bort i TV-mode |

### Resultat
Inga CSS transitions, filters eller animations kvar i TV-mode. Chromecast renderar bara statiska lager som uppdateras vid state-andringar.
