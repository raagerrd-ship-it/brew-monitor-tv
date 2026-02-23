
# Professionell Polish - Bryggövervakaren

Planen fokuserar på visuella och UX-förbättringar som ger ett mer polerat, professionellt intryck utan att ändra funktionalitet eller riskera TV-mode-prestanda.

---

## 1. Typografi-uppgradering

Ladda in **Inter** (eller **DM Sans**) som body-font via Google Fonts. Just nu använder appen bara systemtypsnitt för allt utom logotypen (Cormorant Garamond). En konsekvent, modern sans-serif ger ett omedelbart lyft.

**Tekniskt:**
- Lägg till font-import i `index.html`
- Uppdatera `font-family` i `@layer base` i `src/index.css`
- Tabular-nums-stilen behålls for siffror

---

## 2. Stat-kort: subtil hover-effekt och bättre hierarki

- Ge klickbara stat-kort en mjuk `border-color`-transition vid hover (ej CSS filter p.g.a. TV-begränsning)
- Gör label-texten aningen ljusare (`text-muted-foreground/60` istället för `/50`) for bättre läsbarhet
- Lägg till en tunn `transition: border-color 0.2s` på `StatCard`

**Fil:** `src/components/brew-card/StatCard.tsx`

---

## 3. Brew Card header - stilnivå

- Lägg till brew-nummer (batchNumber) som en diskret tag vid sidan av stiltext, formaterad som `#123`
- Visa senaste uppdateringens relativa tid i ett lite mer polerat format (t.ex. "2h sedan" istf rå datumtext)

**Fil:** `src/components/brew-card/BrewCard.tsx`

---

## 4. Dashboard "empty state" - mer visuellt tilltalande

Uppdatera "Inga öl valda"-meddelandet:
- Lägg till en brewery-ikon (Beer icon från Lucide)
- Mer luftig layout med bättre typografi

**Fil:** `src/components/BrewingDashboard.tsx`

---

## 5. OG-bild och metadata

Byt ut Lovable-defaultbilden i OpenGraph-taggarna mot en egen som matchar appen:
- Uppdatera `og:image` och `twitter:image` i `index.html` till att peka på `/pwa-512x512.png` eller en dedikerad OG-bild
- Uppdatera `twitter:site` till korrekt konto

**Fil:** `index.html`

---

## 6. Splash-screen - mer raffinerad

Lägg till en subtil fade-out på splashskärmen istf abrupt borttagning:
- Wrappa splash i en opacity-transition
- Minimal CSS, ingen blur/filter (TV-säkert)

**Fil:** `src/components/BrewingDashboard.tsx`, `src/index.css`

---

## Sammanfattning

| Ändring | Fil(er) | Komplexitet |
|---------|---------|-------------|
| Body-font (Inter) | `index.html`, `src/index.css` | Liten |
| StatCard hover + labels | `StatCard.tsx` | Liten |
| Brew card header polish | `BrewCard.tsx` | Liten |
| Empty state | `BrewingDashboard.tsx` | Liten |
| OG-metadata | `index.html` | Minimal |
| Splash fade-out | `BrewingDashboard.tsx`, `index.css` | Liten |

Alla ändringar är TV-mode-säkra (inga CSS filters, inga frekventa re-renders). Total påverkan: renare typografi, bättre visuell hierarki, och mer polerade övergångar.
