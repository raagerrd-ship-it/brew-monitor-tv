

## Ljusare och suddigare albumomslag-bakgrund

Justera bildbehandlingen i backend-funktionen `prepare-album-background` for att gora bakgrunden ljusare och mer suddig.

### Andringar

**`supabase/functions/prepare-album-background/index.ts`**
- Oka blur fran `(40, 20)` till `(50, 25)` for starkare oskärpa
- Oka ljusstyrka fran `30%` till `40%` i modulate-anropet

### Efterarbete
- Deploya funktionen
- Rensa cachade bilder i `album-backgrounds`-bucketen sa nya versioner genereras med de uppdaterade installningarna

