

## Kylaren: Profil = Mål

**Problem:** Glykolkylaren visar "Profil: 22" (från `profile_target_temp` i databasen) medan "Mål: 10.5" (det faktiska `target_temp`). Kylaren har ingen fermenteringsprofil — värdet 22 är förmodligen `max_target_temp` eller ett gammalt värde som inte längre är relevant.

**Lösning — backend-fix i `auto-adjust-cooling/index.ts`:**

I SYNC_DATA-loggningen (rad ~298–311), för glykolkylare, sätt `profile_target` till samma som `targetTemp` (ctrl_target) istället för att falla tillbaka på `controllerProfileTarget`.

```typescript
// Rad ~298, ändra:
const originalTarget = profileTarget ?? controllerProfileTarget ?? targetTemp;

// Till:
const isGlycol = !!(controller as any).is_glycol_cooler;
const originalTarget = isGlycol ? targetTemp : (profileTarget ?? controllerProfileTarget ?? targetTemp);
```

Notera: `isGlycol`-variabeln deklareras redan på rad 305, så den behöver flyttas upp eller så använder vi `controller.is_glycol_cooler` direkt i beräkningen.

**Fil att ändra:** 1 fil
- `supabase/functions/auto-adjust-cooling/index.ts` (rad ~296–305)

