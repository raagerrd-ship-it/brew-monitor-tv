

## Progressiv snapshot-gallring

### Fil att ändra
`supabase/functions/_shared/brew-snapshots.ts`

### Ändringar

**1. Lägg till `thinSnapshots`-funktion** (efter `createBrewSnapshots`)

Ny async funktion som:
- Gör en snabb `COUNT(*)` — avbryter om ≤500
- Hämtar alla `id` + `recorded_at` sorterade ASC (paginerat)
- Delar upp i 4 åldersband: <24h (behåll alla), 1-7d (var 2:a), 7-30d (var 4:e), 30d+ (var 8:e)
- Markerar poster för borttagning inom varje band, men behåller alltid första och sista
- Raderar i batchar om 500 (Supabase `.in()` limit)
- Loggar resultatet

**2. Anropa från `createBrewSnapshots`**

Lägg till fire-and-forget-anrop precis före `return snapshots.length`:
```typescript
thinSnapshots(supabase, brewId).catch(() => {});
```

### Teknisk detalj

```typescript
async function thinSnapshots(supabase: any, brewId: string): Promise<void> {
  const { count } = await supabase
    .from('brew_data_snapshots')
    .select('*', { count: 'exact', head: true })
    .eq('brew_id', brewId);

  if (!count || count <= 500) return;

  // Fetch all ids + timestamps, split into age bands
  // <24h: keep all, 1-7d: keep every 2nd, 7-30d: every 4th, 30d+: every 8th
  // Always preserve first & last in each band
  // Delete marked IDs in batches of 500
}
```

Ingen databasändring behövs — RLS-policyn `Service role can delete brew data snapshots` finns redan.

