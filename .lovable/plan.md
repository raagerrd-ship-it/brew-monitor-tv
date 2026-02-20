
## Fixa avklippt logo pa splashskarmen

Loggan (`db-logo.png`) anvander `h-96` (384px) som kan bli for stort for viewporten, sarskilt pa mobil. Dessutom saknas overflow-hantering sa bilden klipps i toppen.

### Andring

**Fil:** `src/components/BrewingDashboard.tsx` (rad 342)

Byt ut den fasta hojden `h-96` mot en responsiv storlek som aldrig overskrider viewporten:

- Anvand `max-h-[60vh]` tillsammans med `w-auto` och `object-contain` sa att loggan alltid far plats och centreras korrekt.
- Lagg till `overflow-hidden` pa containern for extra sakerhet.

Fran:
```tsx
<img src={dbLogo} alt="Bryggövervakare" className="h-96" />
```

Till:
```tsx
<img src={dbLogo} alt="Bryggövervakare" className="max-h-[60vh] w-auto object-contain" />
```

Detta gor att loggan alltid syns i sin helhet, centrerad, oavsett skarmstorlek.
