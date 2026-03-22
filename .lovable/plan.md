

## Omstrukturera loggen efter synk-faser (1a–2c)

### Bakgrund
Idag grupperas loggvyn efter **typ** (Synk-data, PID-reglering, Stall, Glykol-kylare, Skickat till RAPT, Övrigt). Användaren vill att expanderat läge istället följer den faktiska synk-pipelinen med faserna som rubriker.

### Fas-mappning
Baserat på `sync-rapt-data-quick/index.ts`:

```text
1a Auth        → RAPT-autentisering (token-hämtning)
1b Fetch       → Hämta data från RAPT API (controllers + pills)
1c Upsert      → Spara till databas (upsert controllers/pills)
2a Brew        → Brewfather-synk, SG-data, snapshots
2b Auto        → Automation (PID, Stall, Glykol, PWM, RAPT-send)
2c Hist        → Temp-historik, cleanup
```

### Ändringar i `AutoCoolingDecisionLogs.tsx`

#### 1. Ersätt PipelineView-sektionerna med fas-rubriker
Istället för nuvarande sektioner (Synk-data → PID → Stall → Glykol → RAPT) blir strukturen:

- **1a · Auth** — Visa timing från PHASE_TIMINGS (`1a_auth_ms`). Kort — bara tid + ev. TOKEN_REFRESH-steg
- **1b · Hämtning** — Timing (`1b_fetch_ms`). Kort rad
- **1c · Synk-data** — Timing (`1c_upsert_ms`). Här placeras den befintliga SYNC_DATA-tabellen (controllers + pill-data)
- **2a · Bryggdata** — Timing (`2a_brew_ms`). BREW_SG_STATUS-rader om de inte redan visas i sync-tabellen
- **2b · Automation** — Timing (`2b_auto_ms`). Här samlas PID-reglering, Stall-detektering, Glykol-kylare, Pass-through, PWM — alla befintliga sektioner som sub-sektioner
- **2c · Historik** — Timing (`2c_hist_ms`). RAPT_SEND + BATCH_FLUSH (skicka till RAPT) + snapshot-info

#### 2. Fas-rubrik-komponent
Ny liten komponent `PhaseHeader` som visar:
- Fas-kod i monospace (t.ex. `1a`)
- Fas-namn
- Timing i ms (från PHASE_TIMINGS)
- Röd ❌ om fasen felade

#### 3. Behåll befintligt innehåll
Alla tabeller, badges, tooltips etc. behålls som de är — de flyttas bara under rätt fas-rubrik. Inga funktionella ändringar.

#### 4. Fallback
Om PHASE_TIMINGS saknas (t.ex. äldre loggar), visa befintlig flat layout som idag.

### Filer
- `src/components/AutoCoolingDecisionLogs.tsx` — omstrukturera `PipelineView`

