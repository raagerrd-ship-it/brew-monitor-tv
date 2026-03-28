

## Lokal Alarm/Timer-funktion

### Vad byggs
En fristående alarm/timer-funktion som använder det nya generiska footer-slot- och alert-systemet. Helt lokal (ingen databas) — state lever i en React context.

### Arkitektur

```text
┌─ DashboardHeader (mobil) ─────────────────────┐
│  Logo   [🔔alarm] [🔔notif] [⚙settings]      │
│         ↑ ny knapp                             │
└────────────────────────────────────────────────┘

┌─ AlarmTimerDialog (popup) ─────────────────────┐
│  [Timer]  [Alarm]   ← tabs                    │
│                                                │
│  Timer-vy:                                     │
│   Minuter: [  15  ]                            │
│   Alert-text: [ Dags att... ]                  │
│   Visa i sek: [ 10 ]                           │
│   [Starta]                                     │
│                                                │
│  Alarm-vy:                                     │
│   Tidpunkt: [ 14:30 ]                          │
│   Alert-text: [ Dags att... ]                  │
│   Visa i sek: [ 10 ]                           │
│   [Sätt alarm]                                 │
└────────────────────────────────────────────────┘

┌─ DashboardFooter (slot) ──────────────────────┐
│  14:30 / 12:45   ████████░░░░░░   Timer-label │
│  ↑ sluttid/      ↑ progress bar               │
│    nedräknare                                  │
└────────────────────────────────────────────────┘

Alert-overlay (vid 0): använder showAlert()
```

### Nya filer

1. **`src/contexts/AlarmTimerContext.tsx`**
   - State: aktiva timers/alarm (