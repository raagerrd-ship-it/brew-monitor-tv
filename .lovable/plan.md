

# Förenkla enhetskoppling for bryggningar

## Vad som forändras

### 1. Ta bort separat Pill-dropdown i CustomBrewDialog
Pill-valet (rad 615-633 i CustomBrewDialog) tas bort helt. Pill löses alltid automatiskt från vald controller -- detta fungerar redan idag via `sync-custom-brew-pills` edge function.

### 2. Ta bort BrewDeviceLinkDialog helt
Eftersom du aldrig byter controller efter skapande behövs inte den separata dialogen. Filen `BrewDeviceLinkDialog.tsx` raderas och alla referenser i `BrewingDashboard.tsx` tas bort.

### 3. Ta bort "ändra koppling"-knappen på brew cards
Knappen som öppnar BrewDeviceLinkDialog på dashboarden tas bort. Controller-info visas fortfarande som read-only.

### 4. Visa controller + pill tydligare vid skapande
I CustomBrewDialog, under controller-dropdownen, visas automatiskt vilken pill som hör till vald controller (liknande den info som redan finns i BrewDeviceLinkDialog, men inline).

## Resultat
- En dropdown istället for två vid skapande
- Ingen möjlighet att "ändra" koppling i efterhand (eftersom det aldrig behövs)
- Pill visas som info, inte som val

## Tekniska detaljer

**Filer som andras:**
- `src/components/CustomBrewDialog.tsx` -- Ta bort pill-dropdown (rad 615-633), lägga till info-text om vilken pill som hör till vald controller
- `src/components/BrewingDashboard.tsx` -- Ta bort all `deviceLinkDialog`-state, `handleDeviceLinkOpen` callback, och `BrewDeviceLinkDialog`-rendering
- `src/components/BrewDeviceLinkDialog.tsx` -- Radera filen

**Filer som kan behöva andras:**
- `src/components/brew-card/BrewCard.tsx` -- Ta bort eventuell knapp/ikon for att öppna device link dialog

**Ingen databasändring behövs** -- `linked_controller_id` och `linked_pill_id` kolumnerna behålls som de är.

