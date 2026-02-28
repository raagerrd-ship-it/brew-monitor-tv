

## Plan: Brew-sidan (public view) — hämta och skicka `pillCompEnabled`

### Ändringar

**1. Edge function `get-public-rapt-data/index.ts`**
- I brew-id-grenen: hämta `pill_compensation_enabled` från `auto_cooling_settings` (en enkel `.select('pill_compensation_enabled').limit(1).single()`)
- Inkludera `pillCompEnabled` i JSON-svaret

**2. Hook `use-brew-page.ts`**
- Läs `responseData.pillCompEnabled` och exponera som ny state-variabel
- Returnera `pillCompEnabled` från hooken

**3. Sida `Brew.tsx`**
- Destrukturera `pillCompEnabled` från `useBrewPage`
- Skicka `pillCompEnabled={pillCompEnabled}` till `<BrewCard>`

### Filer som ändras
- `supabase/functions/get-public-rapt-data/index.ts` — lägg till `auto_cooling_settings`-query i brew-id-grenen
- `src/hooks/use-brew-page.ts` — ny state + return
- `src/pages/Brew.tsx` — prop-propagering

