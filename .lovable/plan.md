

## Generalisera Dashboard-sidfoten

### Idé
Byt ut det hårdkodade `TimerContext` + `TIMER_FOOTER_HEIGHT`-systemet mot ett generiskt "footer slot"-system. Vilken komponent som helst kan registrera sig som sidfot genom att skicka in sin höjd — dashboarden anpassar layouten automatiskt.

### Ny arkitektur

```text
┌─────────────────────────────────────┐
│  DashboardFooterContext             │
│  ─ footerHeight: number (0 = gömd) │
│  ─ setFooterContent(height | null)  │
│  ─ ref till footer-container        │
└─────────────────────────────────────┘
        ▲                    ▲
        │                    │
   TimerFooter          (framtida
   registrerar           komponenter)
   height=90
```

### Ändringar

**1. Ny context: `src/contexts/DashboardFooterContext.tsx`**
- Ersätter `TimerContext`
- Exponerar `footerHeight` (number, 0 = ingen sidfot) och `setFooterContent(height: number | null)`
- Dashboarden läser `footerHeight` för layout-beräkningar

**2. Uppdatera `TimerFooter.tsx`**
- Anropar `setFooterContent(90)` när synlig, `setFooterContent(null)` vid cleanup
- Tar bort `TIMER_FOOTER_HEIGHT`-exporten (höjden ägs nu av komponenten själv)

**3. Uppdatera `BrewingDashboard.tsx`**
- Byt `useTimerVisibility()` → `useDashboardFooter()`
- Ersätt alla `TIMER_FOOTER_HEIGHT`-referenser med `footerHeight` från context
- Ersätt `showTimerFooter`-boolean med `footerHeight > 0`

**4. Uppdatera providers i `App.tsx`**
- Byt `TimerProvider` → `DashboardFooterProvider`

**5. Ta bort `src/contexts/TimerContext.tsx`**

### Teknisk detalj
Footern renderas fortfarande som child i BrewingDashboard (absolute positioned). Skillnaden är att höjden kommuniceras via context istället för en hårdkodad konstant, vilket gör att framtida sidfots-funktioner (t.ex. fermentation-status, notiser) bara behöver anropa `setFooterContent(height)`.

