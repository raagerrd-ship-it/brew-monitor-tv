

# UI-förbättringar (utan punkt 4)

Tre förbättringar att implementera:

## 1. Standardisera temperaturenheter -- ta bort "C"
Alla temperaturvisningar ska använda `°` utan "C" för konsistens.

- **`src/components/DashboardHeader.tsx`** rad 186: Ändra `°C` till `°` (och `--°C` till `--°`)
- **`src/components/fermentation/FermentationSessionCompact.tsx`** rad 511 och 528: Ändra `°C` till `°`

## 2. Öka stats-höjd för att undvika klippning
- **`src/components/brew-card/BrewCard.tsx`** rad 23: Ändra `CARD_STATS_HEIGHT` från `140` till `148`

## 3. Lägg till klock-ikon före tidsvillkor
Ge villkorstexten (t.ex. "40h 25min kvar") en liten ikon för bättre visuell rytm.

- **`src/components/fermentation/FermentationSessionCompact.tsx`** rad 428-430: Lägg till en `Clock`-ikon (redan importerad) framför villkorstexten för tidsstyrda steg (`hold` med duration, `ramp`). För `wait_for_gravity_stable` använd `Activity`, för `wait_for_sg` använd `Activity`, för `wait_for_acknowledgement` använd `Hand`. Dessa ikoner finns redan i filen.

### Teknisk detalj
Villkors-ikonen väljs med samma `getStepIconWithColor`-logik som redan finns, men i en dämpad/mindre variant för att skilja den från stegtyp-ikonen. Alternativt en enkel `Clock`-ikon i `text-muted-foreground/60` för alla tidsbaserade villkor.

