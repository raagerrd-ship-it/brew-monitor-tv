/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';

declare let self: ServiceWorkerGlobalScope;

// Activate new SW immediately instead of waiting
self.skipWaiting();
clientsClaim();

// Workbox precaching
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// ─── Push Notification Handler ───────────────────────────────────────
self.addEventListener('push', (event) => {
  console.log('[sw] Push event received');

  let data: any = { title: 'Brew Monitor', body: 'Ny notis', icon: '/brew-icon.png' };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch (e) {
      console.error('[sw] Failed to parse push data:', e);
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/brew-icon.png',
    badge: data.badge || '/brew-icon.png',
    data: data.data || {},
    vibrate: [200, 100, 200],
    tag: data.tag || 'brew-notification',
    renotify: true,
  } as NotificationOptions & { vibrate?: number[]; renotify?: boolean };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  console.log('[sw] Notification clicked');
  event.notification.close();

  const url = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
