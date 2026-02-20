

# UI-förbättringar -- visuell granskning

Dashboarden ser redan professionell ut med sin glassmorphism-estetik. Här är de förbättringar jag identifierat efter att ha jämfört alla komponenter:

## 1. Fermenteringskortet -- informationsraden är svårläst

**Problem:** Raden under profilnamnet ("West Coast Ale") har för mycket information packad horisontellt med små prickar som separatorer. Texten "14.0°C -> 13.7° . Håll temperatur . 40h 25min kvar" flyter ihop och är svårläst, speciellt på TV-avstånd.

**Fix:** Ersätt prickseparatorerna med tydligare vertikala streck (`|`) med mer kontrast. Ge stegtypen ("Håll temperatur") och tidsvillkoret ("40h 25min kvar") lite olika färgton för att visuellt skilja dem åt. Gör stegtyp-ikonen färgkodad.

## 2. Fermenteringskortet -- ikonen saknar puls-animation

**Problem:** SessionStatusIcon har statiska glow-effekter men ingen subtil animation som visar att sessionen är aktiv. Jämfört med t.ex. "Jäsning dag 8"-badgen som har tydlig färg, känns ikonen lite livlös.

**Fix:** Lägg till en subtil puls-animation (CSS `animate-pulse` med låg opacitet) på glöd-skuggan runt ikonen för aktiva sessioner. Pausade sessioner förblir statiska.

## 3. Stegbadgen (6/8) -- kan förstärkas

**Problem:** Steg-badgen "6 / 8" är funktionell men visuellt platt. Den har samma stil oavsett hur långt man kommit i profilen.

**Fix:** Lägg till en liten cirkulär progressindikator (ring) runt steg-siffran som visar total progress genom profilen. Alternativt, ge badgen en gradient-bakgrund som reflekterar hur långt man kommit (t.ex. mer ifylld färg vid 6/8 = 75%).

## 4. Stat-kortens temperatur saknar enhetsformatering

**Problem:** I vänstra kortet syns "9.8°" utan "C" och i det högra "13.9°" -- inkonsekvent med resten av interfacet.

**Fix:** Säkerställ att temperaturvärden konsekvent visar "°C" i stat-korten, alternativt gör det konsekvent utan "C" överallt.

## 5. Vänstra kortet saknar temperatur-stat (klippt)

**Problem:** Det vänstra kortet ("Prags Gyllene Lejon") verkar ha en klippt temperatur-stat i övre högra hörnet av stat-griden -- texten "TEMP (18.0°)" syns men värdet och ikonen är avklippta.

**Fix:** Kontrollera att stat-griden inte klipper innehåll. Det kan vara ett overflow-problem i gridens container.

---

## Tekniska detaljer

### Fil: `src/components/fermentation/FermentationSessionCompact.tsx`
- Ändra `Separator`-komponenten (rad 432-434) från en liten prick till ett vertikalt streck med bättre kontrast
- Ge stegtypens label en färg som matchar ikonens färgschema istället för `text-muted-foreground`
- Ge tidsvillkoret en ljusare nyans för att skilja det från stegtypen

### Fil: `src/components/fermentation/SessionStatusIcon.tsx`
- Lägg till en CSS-klass med subtil puls på den yttre `div`-en för aktiva sessioner (inte paused)
- Använda en nyckelbildruteanimation med opacitet 0.6 -> 1.0 på box-shadow för att simulera "levande" glöd

### Fil: `src/components/fermentation/FermentationSessionCompact.tsx` (stegbadge)
- Lägg till en gradient-bakgrund på badgen baserat på `currentStepIndex / totalSteps`
- Bakgrunden går från primary/10 (start) till primary/30 (nästan klar)

### Fil: `src/components/brew-card/TempStat.tsx`
- Verifiera att temperaturen formateras konsekvent med eller utan "C"

### Fil: `src/components/brew-card/BrewCard.tsx`
- Kontrollera `CARD_STATS_HEIGHT` och overflow-hantering i stat-griden (rad ~217) för att säkerställa att inget klipps

