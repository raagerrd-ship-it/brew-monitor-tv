
## Fix: Ta bort ljusskillnad vid header-gränsen

### Orsak
Innehållsytan under headern har `overflow-hidden` (rad 347 i BrewingDashboard.tsx), vilket klipper brew-kortens stora box-shadows (`0 8px 24px`, `0 20px 40px`) vid kanten. Dessa mörka skuggor lägger ett mörkt lager OVANPA bakgrundsbilden i innehållsytan, men inte i headern - vilket skapar en synlig horisontell gräns vid exakt 60px.

### Lösning
Flytta bakgrundsbilden fran BrewingDashboard-containern till **inuti** innehallsytan sa att skuggorna och bakgrunden hamnar i samma stacking context. Alternativt (enklare): ta bort `overflow-hidden` fran innehallsdiven pa desktop, eller ändra brew-kortens box-shadow sa den inte sprider sig uppat.

**Rekommenderad approach**: Byt `overflow-hidden` till `overflow-visible` pa desktop-innehallsytan. Headern har redan `z-20` sa inget innehall kan hamna ovanpa den visuellt. Detta lat skuggorna sprida sig fritt uppat ocksa, sa att morkningseffekten blir jämn over hela sidan.

### Filer som ändras

| Fil | Andring |
|-----|---------|
| `src/components/BrewingDashboard.tsx` | Rad 347: Byt `overflow-hidden` till `overflow-visible` for desktop-grenen sa att brew-kortens skuggor kan sprida sig fritt och inte klipps vid headergränsen |

### Teknisk detalj
Rad 347 idag:
```tsx
<div className={`relative flex flex-col z-0 ${isMobile ? 'h-full overflow-auto' : 'flex-1 overflow-hidden'}`}
```
Andras till:
```tsx
<div className={`relative flex flex-col z-0 ${isMobile ? 'h-full overflow-auto' : 'flex-1 overflow-visible'}`}
```

Detta ar en minimal andring som later kortens skuggor sprida sig jämnt over hela viewporten istället for att klippas vid innehallsytans överkant.
