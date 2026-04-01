

# Timer/Alarm — förbättringsförslag

Efter genomgång av koden ser jag några saker som kan göras smartare:

## 1. Singleton-hantering: slipp dubbla queries
Just nu gör `cancel` och auto-clear alltid `SELECT id` + `UPDATE` (två queries). Eftersom tabellen är en singleton kan du uppdatera direkt utan att först hämta ID:t.

**Ändring**: Ersätt `select('id').single()` + `update().eq('id', ...)` med en enkel `update()` utan filter (eller `.limit(1)`), alternativt använd ett fast, känt ID (t.ex. `'singleton'`).

## 2. Förhindra att alla klienter skriver `fired: true` samtidigt
Nu försöker varje klient (mobil, desktop, TV) skriva `fired: true` till DB när timern når 0 — en onödig race. Bara en klient behöver göra det.

**Ändring**: Använd en conditional update: `UPDATE shared_timer SET fired = true WHERE fired = false AND is_active = true`. Då vinner en klient och övriga ignoreras. De andra klienterna plockar upp ändringen via Realtime.

## 3. Minska footer-omrenderingar
`setFooterSlot` anropas varje sekund (vid varje `remainingMs`-ändring). Footern behöver egentligen bara veta `entry` — nedräkningen kan beräknas lokalt i footern.

**Ändring**: Skicka bara `entry` till footern och låt `AlarmTimerFooterBar` internt köra sin egen `setInterval` för countdown-displayen. Då behöver context bara uppdatera footern vid start/stopp, inte varje sekund.

## 4. Gammal label med tid kvar i DB
DB-raden har fortfarande `label: "Alarm 18:45"` från innan fixar gjordes. `formatRightLabel` hanterar dedupliceringen, men det vore renare att rensa.

**Ändring**: Ingen kodändring — den fixas automatiskt nästa gång ett alarm sätts (label blir bara `"Alarm"`). Kan rensas manuellt om det stör.

## 5. Push-notis vid timeout (valfritt)
Om du inte kollar på skärmen just då timern slår missar du den. Systemet har redan push-infrastruktur (`send-push-notification`).

**Ändring**: Trigga en push-notis via edge function när `fired` sätts till true. Kan göras med en DB trigger eller direkt i klienten.

---

## Teknisk sammanfattning

| Fil | Ändring |
|-----|---------|
| `AlarmTimerContext.tsx` | Förenkla DB-anrop (ta bort dubbla queries), conditional `fired` update, sluta skicka `remainingMs` till footer |
| `AlarmTimerFooterBar.tsx` | Egen intern ticker för countdown istället för att ta emot `remainingMs` som prop |
| Edge function (ny/befintlig) | Valfritt: push-notis vid fired |

Totalt ~3 filer, fokus på att minska onödiga DB-anrop och renders.

