

## Problem: Fler fält från automation-loggen skrivs över

Samma bugg som `duty_pct` — synk-orchestratorn (rad 1413-1414) filtrerar bort **alla** `SYNC_DATA`-rader från automationen och genererar egna, enklare versioner. Förutom `duty_pct`/`duty_samples` (redan fixat) tappas dessa fält som UI:t faktiskt använder:

| Fält | Var i UI | Effekt av att det saknas |
|------|----------|--------------------------|
| `stale` | Röd "offline"-badge, sorting, dimming | Offline-controllrar visas som aktiva |
| `inactive` | Grå "av"-badge, sorting, dimming | Avstängda controllrar ser aktiva ut |
| `preserved` | "bevarad"/"hw"-badge på måltemp | Alltid "hw" istället för "bevarad" |

Fält som **inte** används av UI (ingen effekt idag):
- `is_actively_cooling`, `ramp_target`, `step_index`, `step_type`, `cooloff`

### Lösning

**Fil: `supabase/functions/sync-rapt-data-quick/index.ts`**

Utöka den befintliga `automationDutyByControllerName`-mappen (rad 1334) till att bli en generell "automation metadata per controller"-map som även fångar `stale`, `inactive` och `preserved` från automationens SYNC_DATA-beslut. Sedan injicera dessa tre fält i synk-versionen av SYNC_DATA (rad 1352-1370), precis som `duty_pct` redan görs.

Konkret:
1. Byt namn på `automationDutyByControllerName` till `automationMetaByControllerName`
2. Utöka typen med `stale?: boolean`, `inactive?: boolean`, `preserved?: boolean`
3. Extrahera dessa fält i for-loopen (rad 1335-1349)
4. Injicera dem i details-objektet (rad 1354-1368) med `if (meta.stale) details.stale = true` etc.

### Resultat
Alla UI-synliga fält som automationen beräknar bevaras genom synk-orchestratorns logg-konsolidering.

