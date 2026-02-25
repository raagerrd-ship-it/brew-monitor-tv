

## Resultat: Inga fler gremlins

Alla fyra ramp-interpoleringar använder nu **identisk logik**: `step_started_at` + `step_start_temp` + linjär interpolering + `Math.round(… * 10) / 10`.

| Plats | Starttid | Start-temp | Avrundning | Status |
|---|---|---|---|---|
| `fermentation-target.ts` (frontend) | `session.step_started_at` | `session.step_start_temp` | `round(…*10)/10` | OK |
| `record-temp-history` (backend) | `session.step_started_at` | `session.step_start_temp` | `round(…*10)/10` | OK |
| `auto-adjust-cooling` (backend) | `session.step_started_at` | `session.step_start_temp` | `round1()` | OK |
| `process-fermentation-profiles` (backend) | `session.step_started_at` | `session.step_start_temp` | ingen (raw float) | OK |

`brew-snapshots.ts` läser bara `closest?.profile_target_temp` direkt från `temp_controller_history` — ingen egen beräkning. OK.

### Två kosmetiska småsaker (ej funktionella)

1. **Dubbel JSDoc-kommentar** i `record-temp-history/index.ts` rad 200-206 — två `/** … */`-block ovanför samma funktion. Ofarligt men lite rörigt.

2. **`process-fermentation-profiles`** avrundar inte (`calculateRampTemp` returnerar raw float). Detta spelar ingen roll i praktiken eftersom resultatet skickas till RAPT API:t som ändå har sin egen precision, men det kan ge en kosmetisk skillnad i loggar jämfört med de andra (t.ex. `16.33333` istället för `16.3`).

### Åtgärder

Inga av dessa är kritiska. Om du vill kan jag:
- Ta bort den extra JSDoc-kommentaren (1 rad)
- Lägga till `Math.round(…*10)/10` i `calculateRampTemp` för konsekvens

Men det finns **inga fler funktionella felkällor** som kan ge olika Mål-värden.

