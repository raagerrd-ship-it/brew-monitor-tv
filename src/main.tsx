import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// In TV mode or iframe: unregister service workers to save CPU/memory on Chromecast
const isIframe = window.self !== window.top;
const isTvParam = new URLSearchParams(window.location.search).get('tv') === 'true';
const isChromecast = navigator.userAgent.toLowerCase().includes('crkey');

if ((isIframe || isTvParam || isChromecast) && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      registration.unregister();
      console.log('[TV] Service worker unregistered');
    }
  });
  if ('caches' in window) {
    caches.keys().then((names) => {
      for (const name of names) {
        caches.delete(name);
      }
      if (names.length > 0) console.log('[TV] SW caches cleared');
    });
  }
}

// Auto-reload when a new Service Worker takes control (e.g. after publish)
// Skip in TV mode since we handle updates via remote refresh button
if ('serviceWorker' in navigator && !isIframe && !isTvParam && !isChromecast) {
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    console.log('[SW] New service worker activated, reloading...');
    window.location.reload();
  });
}

// Remove the inline <style> tag from index.html that sets overflow:hidden
// (needed for Chromecast/TV to prevent scrollbars before JS loads, but blocks scrolling on mobile/desktop)
if (!isTvParam && !isChromecast) {
  // Find and remove the style tag that sets overflow:hidden
  const styles = document.querySelectorAll('head > style');
  styles.forEach(style => {
    if (style.textContent?.includes('overflow:hidden')) {
      style.remove();
    }
  });
}

createRoot(document.getElementById("root")!).render(<App />);
