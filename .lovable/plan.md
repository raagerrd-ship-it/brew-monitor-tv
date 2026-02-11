
## Glassmorphism-styling for TimerFooter

Anpassa TimerFootern till samma visuella stil som StatCard-korten genom att lägga till glassmorphism-effekter.

### Vad som andras

**TimerFooter.tsx** -- huvudcontainern (rad ~249-261):

Byta ut den nuvarande opaka gradient-bakgrunden mot StatCard-inspirerad glassmorphism:

- **Bakgrund**: Semi-transparent gradient med `backdrop-blur-xl` istallet for heltatckande `bg-gradient-to-r`
- **Border**: Tunn 1px border med lag opacitet (som StatCards `colorWithOpacity(color, 0.15)`)
- **Ljusreflektion**: Lagg till samma 1px toppreflektion som StatCard har (linjart gradient fran transparent till vit med lag opacitet)
- **Skugga**: Flerskiktad skugga som matchar StatCard-monstret (`0 8px 24px ... inset 0 1px 0 ...`)
- **Kolumn-separatorer**: Gora border-r/border-l mer subtila, med `border-white/5` istallet for `border-border/50`

### Tekniska detaljer

**Normal mode (kok)**:
```css
background: linear-gradient(145deg, hsl(var(--primary) / 0.06) 0%, hsl(222 20% 12% / 0.7) 100%)
backdrop-filter: blur(24px)
border-top: 1px solid hsl(0 0% 100% / 0.08)
box-shadow: 0 -8px 24px hsl(222 30% 3% / 0.5), inset 0 1px 0 hsl(0 0% 100% / 0.08)
```

**Mask-mode (orange)**:
```css
background: linear-gradient(145deg, hsl(24 80% 15% / 0.4) 0%, hsl(222 20% 12% / 0.7) 100%)
backdrop-filter: blur(24px)
border-top: 1px solid hsl(24 80% 40% / 0.15)
```

Lagg aven till toppreflektion-div (samma som StatCard):
```html
<div class="absolute inset-x-0 top-0 h-[1px]"
  style="background: linear-gradient(90deg, transparent 15%, hsl(0 0% 100% / 0.1) 40%, ...)" />
```

### Fil som andras
- `src/components/TimerFooter.tsx` -- bara styling, ingen logikandring
