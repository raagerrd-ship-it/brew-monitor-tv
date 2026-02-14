

# Flytta Sonos-widgeten till logotypens position

## Sammanfattning
Sonos-widgeten flyttas fran sin nuvarande position (till hoger under headern) till att ligga direkt over logotypen "BryggövervakareTV" i headerns vanstra horn. Widgeten blir smalare och bredare (mer langsmal) med minimala marginaler mot ytterkanterna, sa att den inte tackar nagon annan del av dashboarden.

## Visuell forandring

```text
NUVARANDE LAYOUT:
+--[Logo]--------[Controllers]--------[Clock]--+
|                                               |
|                                  [Sonos 280x130] <-- flytande, 88px under header
|   [BrewCard]   [BrewCard]   [BrewCard]        |

NY LAYOUT:
+--[Sonos ovanpa Logo]--[Controllers]--[Clock]--+
|                                               |
|   [BrewCard]   [BrewCard]   [BrewCard]        |
```

Widgeten placeras i headern, ovanpa logotypen, med minimal padding mot vanster- och toppkant. Nar inget spelas visas logotypen som vanligt.

## Andringar

### 1. SonosWidget -- ny "header" / "slim" variant
- Ny storlek: ca **300x50px** (langsmal, ungefar samma hojd som headern)
- Minimal padding, ingen rounded-xl (anvand rounded-lg istallet)
- Minska skuggorna for att passa headerns tunna profil
- Behall album art som bakgrund men med starkare darkning for text-lasbarhet i det smalare formatet
- Progress bar och nedrakning behalls men med tunnare profil
- Ta emot en ny prop `variant?: "floating" | "header"` for att styra storlek/stil

### 2. BrewingDashboard -- flytta widgeten till headern
- Ta bort den flytande `<div className="absolute z-10">` som positionerar widgeten under headern
- Skicka istallet Sonos-widgeten som en prop eller rendera den direkt i header-raden
- Widgeten renderas i headerns vanstra kolumn, direkt ovanpa logotypen (same position)
- Nar Sonos spelar: widgeten visas, logotypen doljs
- Nar inget spelas: logotypen visas som vanligt

### 3. DashboardHeader -- ta emot Sonos-widget
- Lagg till en optional prop `sonosSlot?: React.ReactNode`
- I desktop-layoutens vanstra kolumn: rendera `sonosSlot` istallet for `<Logo />` om sonosSlot finns
- Fallback till `<Logo />` om inget sonosSlot skickas

## Tekniska detaljer

**SonosWidget.tsx:**
- Ny prop `variant` med default `"floating"`
- Nar `variant === "header"`: width ~300px, height ~50px, border-radius 8px, tightare padding, mindre typsnitt
- Progress bar height: 2px, countdown text: 9px
- Behall all befintlig logik (preloading, refs, etc) -- bara visuella justeringar

**BrewingDashboard.tsx:**
- Flytta `<SonosWidget>` fran den absolut-positionerade diven till en variabel som skickas som `sonosSlot` till `<DashboardHeader>`
- Widget renderas med `variant="header"`

**DashboardHeader.tsx:**
- Ny prop `sonosSlot?: React.ReactNode`
- I desktop-sektionen (rad 93-95): `{sonosSlot || <Logo />}`
- Ingen annan andring i headern

