

# Enhetlig header: Sonos + RAPT i samma stil

## Vad ändras

### 1. SonosWidget header-variant → samma layout som RAPT controller-item

Istället för en separat "box" med egen bakgrund, shadow och border, renderas Sonos-info som en **header-item** med samma stil som en RAPT-controller:

- **Ta bort** från header-variant: `boxShadow`, `border`, container `background`, albumart-bild, gradient-overlay, fast `width`/`height`
- **Behåll**: text (artist — track), progress-bar, preload-logik (för floating)
- **Progress-bar i botten** — exakt samma stil som RAPT battery-bar: `absolute bottom-1 left-1.5 right-1.5`, 4px hög, mörk bakgrund med inset-shadow, vit fyllning med glow
- **Transparent bakgrund** — hover ger samma `hsl(222 18% 15%)` som controller-items
- **Text**: vit, samma storlek (16px), `truncate`

### 2. RAPT-baren — ta bort glasmorfism-container

- Ta bort yttre containerns `background` (gradient), `border`, `backdrop-blur-xl`, `boxShadow`, fast `height: 50px`
- Controller-items renderas direkt med befintliga vertikala dividers
- Warning-border (`showWarning`) → per-item röd glow istället

### 3. Normalisera header-ikoner

- Alla ikoner (Settings, Timer, Bell): `opacity-50` bas, hover `opacity-90`
- Desktop högergrupp: `gap-3` istället för `gap-4`

## Filer

1. **`src/components/sonos/SonosWidget.tsx`** — header-variant: ta bort container-bakgrund/shadow/border/albumart, rendera som transparent item med battery-bar-stil progress i botten
2. **`src/components/DashboardHeader.tsx`** — ta bort glasmorfism från RaptControllerBar, normalisera ikoner

## Visuellt resultat

```text
Före:  [██ Sonos box ██]  [══ RAPT glasmorfism-bar ══]  Klocka | Icons
Efter: Artist — Track ·── Ctrl1 ── Ctrl2 ──· Klocka | Icons
       ▬▬▬▬▬▬ prog     ▬▬ batt   ▬▬ batt
```

Alla element transparent, progress/battery-bars i botten med identisk stil.

