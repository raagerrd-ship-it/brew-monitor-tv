## Problem

"System"-raderna i Synkroniseringshistorik (Settings → Historik) är PWM-OFF-cykler från `execute-pwm-off`. De har bara två steg (`PWM_OFF` + `RAPT_SEND` med "PWM revert"-meddelande) och:

1. **Badgen visar "System"** — den dedikerade `isPwmOffLog`-pathen i `EntryRow` (rad 492–504) skapar visserligen en `❄️ Gul 10% – OFF`-badge, men `final_result` skrivs som `⚡ PWM OFF: Gul → 19.6° (10%)` så detektionen via `final_result.startsWith('⚡ PWM OFF:')` borde fungera. Trots det visar UI:t "System", troligen för att vissa rader saknar `controller_name` i `details` eller har annat case.
2. **Innehållet är tomt vid expansion** — `PWM_OFF` ligger i `PIPELINE_STEPS` (undanträngd från "Övrigt") och `RAPT_SEND` med "PWM revert" filtreras bort från `raptSends`. Ingen sektion renderar något för dessa rader, så expansionen visar bara meta-headern (Steg/Tid/Resultat) på en nästan tom kort.

## Lösning

Endast i `src/components/AutoCoolingDecisionLogs.tsx`:

### 1. Robust PWM-OFF badge

- Detektera PWM-OFF-rader oberoende av `final_result`-text: om `log.decisions` innehåller ett `PWM_OFF`-steg, behandla som PWM-cykel.
- Fallback för controller-namn: om `details.controller_name` saknas, parsa ut det från `message` (`/^([^:]+):/`).
- Garantera att badge alltid blir `❄️/🔥 {Name} {duty}% – OFF` (aldrig "System" för PWM-cykler).

### 2. Dedikerad PWM-OFF-sektion i expansionen

Lägg till en liten sektion direkt under meta-headern när `log.decisions` innehåller `PWM_OFF`:

```
PWM-revert
└── ❄️ Temp Controller Gul: burst 30s (10% duty) → mål 19.6 °C   [✅ 366 ms]
```

Visar:
- Controllernamn + mode-ikon
- Burst-tid och duty %
- Revert-temperatur
- Status från tillhörande `RAPT_SEND` (success/fail + duration_ms)

### 3. Cosmetic: byt fallback-label från "System" till "Tom cykel"

Om en rad verkligen saknar både controller-aktivitet, PWM-OFF och fel — märk den "Tom cykel" istället för "System" så att det blir tydligare att det inte är något att titta på.

## Tekniska detaljer

- Allt sker i `src/components/AutoCoolingDecisionLogs.tsx` (`EntryRow` runt rad 492–620).
- Inga databas- eller edge function-ändringar.
- Inget API-anrop läggs till; data finns redan i `log.decisions`.
- Hjälpfunktion `parsePwmOff(log)` returnerar `{ controllerName, mode, dutyPct, dutySeconds, revertTarget, raptSendOk, raptSendMs } | null`.

## Verifiering

1. Expandera en `25 maj 11:33`-liknande rad → ska visa en PWM-revert-sektion med Gul + duty.
2. Kolla att collapsed-badgen visar `❄️ Gul 10% – OFF` (aldrig "System") för PWM-rader.
3. Vanliga 5-min-cykler ska se oförändrade ut.
