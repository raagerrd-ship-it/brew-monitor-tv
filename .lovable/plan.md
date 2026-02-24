
# Fix: Build-fel i Settings.tsx

## Problem

Det saknas en avslutande `}` for `if (data) {`-blocket i `loadAutoCoolingSettings`-funktionen (rad 427). Detta orsakar alla tre TypeScript-felen:
- `try` expected (rad 445) -- `catch` hittas utanfor ett `try`-block
- `catch or finally expected` (rad 448) -- ytterligare en felaktig struktur
- `} expected` (rad 2157) -- en obalanserad klammerparentes genom hela filen

## Fix

En enda andring i `src/pages/Settings.tsx`: Lagg till en avslutande `}` efter rad 434 for att stanga `if (data) {`-blocket.

### Teknisk detalj

```text
Rad 427:   if (data) {
Rad 428-434: setState-anrop...
+           }  <-- saknas, laggs till har
Rad 436:   // Load last adjustment...
```

Filen for ovrigt behovs inte andras.
