

## Etikett som bakgrundsbild med fade-effekt

Istallet for en liten miniatyrbild i headern, visa etiketten som en stor, subtil bakgrundsbild i kortets ovre vanstra horn som tonar ut (fadar) mot hoger och nerat. Detta ger en mer exklusiv, premium-kansla at korten.

### Design

- Etikettbilden placeras som en absolut positionerad bakgrund i kortets ovre vanstra horn
- Bilden ar stor (ca 140-160px) och halvtransparent (20-30% opacity)
- En CSS mask-image med radiell/linjar gradient gor att bilden tonar ut mjukt mot hoger och nerat
- Den lilla miniatyrbilden i headern tas bort - etiketten syns istallet som en atmosfarisk bakgrund
- Texten (olnamn, stil, status) ligger kvar ovanpa och forblir lasbar tack vare den laga opaciteten

```text
+------------------------------------------+
|  [etikett fade ->]                       |
|  [etikett       ]  Prags Gyllene Lejon   |
|  [fade nedat    ]  Pilsner - 2024-01-15  |
|  [    v         ]                        |
|------------------------------------------|
|                                          |
|            [diagram]                     |
|                                          |
|------------------------------------------|
|  SG  |  ABV  |  Temp  |  Att  |  Batt   |
+------------------------------------------+
```

### Teknisk detalj

**Fil:** `src/components/brew-card/BrewCard.tsx`

1. **Ta bort** den befintliga miniatyrbilden (rad 99-109) som visar etiketten som en 64x64px thumbnail i headern.

2. **Lagg till** en ny absolut positionerad div direkt inuti Card-komponenten (efter glass highlight overlay):

```tsx
{brew.label_image_url && (
  <div
    className="absolute top-0 left-0 pointer-events-none z-0"
    style={{
      width: '160px',
      height: '160px',
      opacity: 0.2,
      maskImage: 'linear-gradient(to right, black 30%, transparent 100%), linear-gradient(to bottom, black 30%, transparent 100%)',
      maskComposite: 'intersect',
      WebkitMaskImage: 'linear-gradient(to right, black 30%, transparent 100%), linear-gradient(to bottom, black 30%, transparent 100%)',
      WebkitMaskComposite: 'source-in',
    }}
  >
    <img
      src={brew.label_image_url}
      alt=""
      className="w-full h-full object-cover"
    />
  </div>
)}
```

3. **Lagg till `z-[1]`** pa header-div:en (rad 89) for att sakerstalla att texten ligger ovanfor bakgrundsetiketten.

Resultatet: En subtil, atmosfarisk etikett som ger varje olkort en unik karaktar utan att ta plats fran innehallet.

