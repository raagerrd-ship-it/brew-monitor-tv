

## Web Push-notifieringar — Plan

Baserat på den fungerande implementationen i [Truck Flow](/projects/2d769743-6835-47c6-b301-6d6c6881931f) skapar vi samma Web Push-system här, anpassat för Brew Monitor.

### Arkitektur

```text
pending_notifications INSERT
        │
        ▼
  insertNotification()  ──►  send-push-notification (edge fn)
                                    │
                                    ▼
                            push_subscriptions (tabell)
                                    │
                                    ▼
                            webpush.ts (@negrel/webpush)
                                    │
                                    ▼
                            Browser Push API → sw.js → OS-notis
```

### Steg

**1. Databastabell `push_subscriptions`**
- Kolumner: `id`, `endpoint` (text, unique), `subscription` (jsonb — full PushSubscription), `device_info` (text), `created_at`, `last_used_at`
- RLS: Anyone can insert/update/delete/select (appen har inga autentiserade användare för denna funktionalitet)
- Ingen koppling till user_id — brew monitor har en enda användare

**2. VAPID-nycklar**
- Edge function `generate-vapid-keys` (kopierat och anpassat från Truck Flow) — genererar JWK-nycklar
- Resultatet sparas som secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
- `VITE_VAPID_PUBLIC_KEY` sparas som env-variabel i `.env` (publik nyckel i browser-format)

**3. Service Worker (`public/push-sw.js`)**
- Separat från PWA:s workbox-genererade SW — registreras parallellt
- Lyssnar på `push`-event, visar OS-notis med titel/body/ikon
- `notificationclick` öppnar/fokuserar appen

**4. Client-side registration (`src/lib/web-push-registration.ts`)**
- `getServiceWorkerRegistration()` — registrerar push-SW
- `subscribeToWebPush(vapidPublicKey)` — skapar PushSubscription
- `autoRegisterWebPush()` — körs vid app-load om permission redan granted, sparar subscription till `push_subscriptions`-tabellen

**5. Edge function `send-push-notification`**
- `webpush.ts` — samma implementation som Truck Flow (`jsr:@negrel/webpush@0.5.0`)
- `index.ts` — tar emot `{ title, body, data }`, hämtar alla subscriptions, skickar push till alla, rensar expired (410)

**6. Koppla ihop med `insertNotification`**
- I `supabase/functions/_shared/notifications.ts`: efter insert i `pending_notifications`, anropa `send-push-notification` edge function via `fetch()` med titel och body
- Alternativt: DB webhook/trigger — men direkt fetch är enklare och mer pålitligt

**7. UI-integration**
- I `App.tsx` eller `DashboardHeader.tsx`: kör `autoRegisterWebPush()` vid mount
- Befintlig `NotificationBell` behöver ingen ändring — den visar redan notiser från `pending_notifications`
- Lägg till en "Aktivera push-notiser"-knapp i Settings om permission inte redan är granted

### Beroenden
- Inga nya npm-paket (Web Push API är inbyggt i browser)
- Edge function använder `jsr:@negrel/webpush@0.5.0` (Deno-kompatibelt, samma som Truck Flow)

### Säkerhet
- VAPID private key lagras bara som Supabase-secret, aldrig i klientkod
- VAPID public key är publik och säker att exponera i `.env`

