

# UI-finslipning: Proffsigare detaljer (Omgang 3)

Dashboarden ser proffsig ut redan. Har ar de sista detaljerna som kan hoja den ytterligare.

## 1. Doda hjalpfunktioner i utils.ts

**Fil:** `src/components/brew-card/utils.ts`

Funktionerna `calculateThermometerFill`, `calculateBatteryFillWidth` och `calculateAbvFillOffset` (rad 74-89) anvands inte langre efter att ikonerna togs bort i forra omgangen. Ta bort dem for renare kod.

## 2. Subtitle-separator: bygg en visuell separator

**Fil:** `src/components/brew-card/BrewCard.tsx`

Subtiteln under olnamnet anvander ` • ` (text-separator) mellan stil, datum och batchnummer. Byt till samma pipeseparator-stil (`│`) som fermenterings-sessionen anvander, for visuell konsekvens. Alternativt, anvand en tunn `·` (middot) istallet for `•` (bullet) som ar mer diskret och proffsig.

## 3. Controller-barens batteriprocent: fadad decimal

**Fil:** `src/components/DashboardHeader.tsx` (rad 200-205)

I controller-baren visas batteriprocenten som t.ex. `59%`. Brew-kartens BatteryStat visar batteriet med fadad decimal (t.ex. `60.4%` dar `.4%` ar fadad). For konsekvens, visa decimaler aven i controller-baren, med fadad decimal-stil.

## 4. Stat-kortens "TEMP"-etikett: finare formatering

**Fil:** `src/components/brew-card/TempStat.tsx` (rad 111-115)

Etiketten `TEMP (14.0°)` ser lite trång ut. Andringen ar att gora parenteserna och malsiffran fadade (som en subtitel snarare an del av labeln) for att dra ner visuellt brus:
- `Temp` i full opacitet, `(14.0°)` i `text-muted-foreground/50`

## 5. Klockans datumrad: liten polering

**Fil:** `src/components/Clock.tsx` (rad 36-44)

Datumraden visar "FRE 20 FEB." med stor bokstav och punkt. Ta bort den avslutande punkten (`.`) fran formateringen for en renare look -- den laggs till automatiskt av `toLocaleDateString` i vissa lokaler.

## Teknisk sammanfattning

- 5 filer berors
- Inga logikandrigar, bara visuell polish och kodrensning
- Alla andringar ar sma och isolerade

