
# Skydd mot oavsiktlig nollstallning av inlarda baselines

## Problem
Knapparna for att nollstalla enskilda och alla inlarda baselines saknar bekraftelsesteg. Ett felklick raderar data som tagit lang tid att lara sig.

## Losning
Lagga till bekraftelsedialoger (AlertDialog) pa bade enskild och "Nollstall alla"-knappen.

## Andringar

### `src/components/LearnedCompensationBaselines.tsx`

1. **Importera AlertDialog-komponenter** fran `@/components/ui/alert-dialog`

2. **Enskild nollstallning (papperskorgs-ikonen per rad)**:
   - Wrappa knappen i en `AlertDialog` med bekraftelsetext: "Ar du saker? Denna inlarda baseline tas bort permanent."
   - Visa vilken bucket (t.ex. "Medium (1.5-3 grader)") och controller som paverkas
   - Knappar: "Avbryt" / "Nollstall"

3. **Nollstall alla-knappen**:
   - Wrappa i en `AlertDialog` med tydlig varning: "Alla inlarda baselines for samtliga kontrollrar tas bort. Systemet borjar om fran noll."
   - Destruktiv stil pa bekraftelseknappen
   - Knappar: "Avbryt" / "Ja, nollstall alla"

## Tekniska detaljer

Anvander befintliga `AlertDialog`-komponenter (redan installerade via Radix). Inga nya beroenden. Inga databasandringar.

```text
Fore:  Klick -> direkt radering
Efter: Klick -> AlertDialog ("Ar du saker?") -> Bekrafta -> radering
```
