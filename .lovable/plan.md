
# Optimeringsplan: TV-läge utan skalning

## Problemanalys

Just nu använder `AspectRatioContainer` **CSS `transform: scale()`** för både desktop och TV-läge. Detta är problematiskt på TV-hårdvara (Chromecast) av flera anledningar:

1. **GPU-overhead**: `transform: scale()` skapar ett nytt compositing layer och kräver kontinuerlig GPU-bearbetning
2. **Layout thrashing**: Skalningen triggar reflows vid varje resize-event
3. **Onödig komplexitet**: TV:n har redan 1920x1080 - ingen skalning behövs

## Lösning

Skapa två separata renderingsvägar:

```text
┌─────────────────────────────────────────────────────────────┐
│                    AspectRatioContainer                      │
├─────────────────┬───────────────────┬───────────────────────┤
│   TV-läge       │   Desktop         │   Mobil               │
├─────────────────┼───────────────────┼───────────────────────┤
│ • Ingen         │ • transform:      │ • Ingen               │
│   skalning      │   scale()         │   aspect-ratio        │
│ • Direkt 1920   │ • Preview av      │ • Normal flow         │
│   x1080 layout  │   TV-layout       │                       │
│ • Maximal       │ • Letterbox/      │                       │
│   prestanda     │   pillarbox       │                       │
└─────────────────┴───────────────────┴───────────────────────┘
```

## Tekniska ändringar

### 1. Uppdatera AspectRatioContainer

Modifiera komponenten så att den detekterar TV-läge och renderar utan skalning:

**TV-läge (optimerat):**
- Renderar direkt i 1920x1080 utan transform
- Ingen scale-beräkning
- Fullskärm utan compositing overhead

**Desktop (preview-läge):**
- Behåller nuvarande `transform: scale()` för att förhandsgranska TV-layout
- Letterbox/pillarbox beroende på fönsterstorlek

### 2. Konkreta kodändringar

```tsx
// AspectRatioContainer.tsx

// TV-läge: Direkt rendering utan skalning
if (isTvMode) {
  return (
    <AspectRatioContext.Provider value={{ 
      isLocked: true, 
      width: REFERENCE_WIDTH, 
      height: REFERENCE_HEIGHT,
      scale: 1  // Alltid 1 i TV-läge
    }}>
      <div 
        className="fixed inset-0 bg-background overflow-hidden flex flex-col"
        style={{
          width: '100vw',
          height: '100vh',
        }}
      >
        {children}
      </div>
    </AspectRatioContext.Provider>
  );
}

// Desktop: Behåll skalning för preview
// ... befintlig kod med transform: scale()
```

### 3. Potentiella CSS-optimeringar för TV

För att ytterligare minska GPU-belastning i TV-läge:
- Lägg till `will-change: auto` (eller ta bort helt) istället för `will-change: transform`
- Undvik `backdrop-blur` på stora element
- Använd `contain: layout paint` på kort för att isolera repaints

## Förväntade resultat

| Metrik | Före | Efter |
|--------|------|-------|
| Long tasks | ~26 st, avg 700ms | Nära 0 |
| GPU-användning | Hög (skalning) | Låg (direkt) |
| Layout reflows | Vid resize | Inga |

## Filer som ändras

1. `src/components/AspectRatioContainer.tsx` - Separat TV-rendering utan scale
