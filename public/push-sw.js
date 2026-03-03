// Push Notification Service Worker for Brew Monitor
// Separate from the PWA workbox service worker

self.addEventListener('push', (event) => {
  console.log('[push-sw] Push event received');

  let data = { title: 'Brew Monitor', body: 'Ny notis', icon: '/brew-icon.png' };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch (e) {
      console.error('[push-sw] Failed to parse push data:', e);
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
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  console.log('[push-sw] Notification clicked');
  event.notification.close();

  const url = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing window if open
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // Open new window
      return clients.openWindow(url);
    })
  );
});
