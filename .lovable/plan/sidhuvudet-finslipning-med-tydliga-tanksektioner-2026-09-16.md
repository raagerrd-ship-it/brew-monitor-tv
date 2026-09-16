# Sidhuvudet — finslipning med tydliga tanksektioner

Utgångspunkt: dagens menyrad och chips-känsla behålls. All information per jäskärl finns kvar, men varje tank blir en tydligt avgränsad sektion i raden.

## Vad som ändras

1. **Vertikala avskiljare**
   - En tunn, enhetlig hårlinje (1 px, dämpad) mellan varje sektion: Glykol | Gul | Blå | Grön | Sonos | Klocka
   - Samma höjd, opacitet och marginal på alla linjer — inga blandade kanter/färger

2. **Varje tanksektion innehåller (som idag, men konsekvent)**
   - Tanknamn (GLYKOL / JÄSKÄRL GUL / BLÅ / GRÖN) i tankens accentfärg
   - Temperatur + mål med `›`-notation, dämpad decimal
   - Givarkälla som symboler (PT100 / pill — tända när de levererar, släckta när tysta)
   - Batteri för pillen: symbol + 10-segmentslinje längst ner, gråad med ålder vid gammal avläsning
   - Orange hand/triangel vid manuellt läge

3. **Detaljpolish**
   - Samma teckenstorlek, radhöjd och baseline-justering i alla sektioner
   - Enhetlig ikonstorlek och visuell vikt
   - Sonos, notis, meny och klocka optiskt centrerade mot tanksektionerna

## Vad som INTE ändras

- En rad, 60 px hög — inget staplat på höjden
- Inga rutor/kort med egen bakgrund inne i listen
- Innehåll, ordning, datakällor, TV-läge och mobilläge oförändrade
- Alla färger via befintliga design-tokens

## Verifiering

- Skärmbild före/efter i appen och TV-läget
- Bygg utan fel
