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
  // Also clear SW caches
  if ('caches' in window) {
    caches.keys().then((names) => {
      for (const name of names) {
        caches.delete(name);
      }
      if (names.length > 0) console.log('[TV] SW caches cleared');
    });
  }
}

createRoot(document.getElementById("root")!).render(<App />);
