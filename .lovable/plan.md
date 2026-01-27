
# Plan: Fixa FPS-räknare toggle i Settings

## Problem
Togglen för FPS-räknaren i Settings går att klicka på och ändrar visuellt state (checked/unchecked), men inställningen verkar inte persisteras eller påverka FPS-räknarens visibilitet.

## Analys
Efter att ha granskat koden har jag identifierat att:

1. **Kontextstrukturen är korrekt** - `FpsCounterProvider` omsluter både Settings-sidan och FpsCounter-komponenten i `App.tsx`
2. **Switch-kopplingen ser korrekt ut** - `checked={showFps}` och `onCheckedChange={setShowFps}` är rätt konfigurerade
3. **localStorage-hantering finns** - Värdet sparas och läses från localStorage

## Möjliga orsaker
1. **Re-render problem** - Komponenten kanske inte uppdateras korrekt när state ändras
2. **localStorage synkronisering** - Kan finnas race condition vid läsning/skrivning
3. **Kontext-initialisering** - Initialt värde kan läsas fel

## Lösning
Jag kommer att:

1. **Lägga till console.log för debugging** - Temporärt för att se om `setShowFps` faktiskt anropas och vad värdet är

2. **Verifiera localStorage-nyckeln** - Säkerställa att samma nyckel används överallt

3. **Testa med en enklare implementation** - Om problemet kvarstår, förenkla kontexten för att isolera problemet

## Tekniska ändringar

### Fil: `src/contexts/FpsCounterContext.tsx`
- Lägg till console.log i `setShowFps` för att verifiera att funktionen anropas
- Verifiera att localStorage uppdateras korrekt

### Fil: `src/pages/Settings.tsx`
- Kontrollera att `useFpsCounter()` returnerar korrekta värden
- Eventuellt lägga till lokal debugging

## Prioritet
Hög - Detta är en enkel UX-bugg som bör vara snabb att lösa med rätt debugging.
