

# Fixa pixlig bakgrundsbild - hämta högre upplösning

## Problem
Spotify oEmbed-endpointen returnerar thumbnails på ca 300x300 pixlar. Dessa skalas upp till 1280x720 for bakgrunden -- en uppskalning pa over 4x -- vilket ger en tydligt pixlig bild. Widgeten (280x130) paverkas inte eftersom den ar mindre an kallan.

## Losning
Spotify's bild-CDN anvander storlekskoder i URL:en. Genom att byta storlekskoden fran 300px-varianten till 640px-varianten far vi en mycket battre kalla for bakgrundsgenereringen.

Storlekskoder i Spotify CDN:
- `ab67616d000048a1` = 64x64
- `ab67616d00001e02` = 300x300
- `ab67616d0000b273` = 640x640

640x640 ar fortfarande mindre an 1280x720, men med blur applicerad (som anda ar avsedd for bakgrunden) blir resultatet avsevart battre an fran 300x300.

## Teknisk andring

### Fil: `supabase/functions/_shared/sonos-art.ts`

Lagg till en funktion som uppgraderar Spotify CDN-URL:er till 640x640-varianten:

```typescript
function upgradeSpotifyImageSize(url: string): string {
  // Replace 300x300 size code with 640x640
  return url.replace('ab67616d00001e02', 'ab67616d0000b273');
}
```

Applicera detta pa `thumbnail_url` fran oEmbed innan den returneras, sa att bade bakgrund och widget far tillgang till hogre upplosning som kalla.

### Paverkan
- Bakgrunden genereras fran 640x640 istallet for 300x300 -- drygt 4x fler pixlar
- Widgeten paverkas inte negativt (den skalas anda ner)
- Ingen ny cache-version behovs for widgeten, men bakgrunder med ny kalla kommer automatiskt genereras om tack vare att bilddatan skiljer sig (track hash ar densamma, men bilden blir battre)
- Ingen databasandring kravs

