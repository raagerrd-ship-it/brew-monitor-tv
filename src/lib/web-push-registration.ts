import { supabase } from "@/integrations/supabase/client";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

let swRegistration: ServiceWorkerRegistration | null = null;
let registrationPromise: Promise<ServiceWorkerRegistration> | null = null;

/**
 * Register the push service worker (separate from PWA workbox SW)
 */
export async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  if (swRegistration) return swRegistration;
  if (registrationPromise) return registrationPromise;

  registrationPromise = navigator.serviceWorker
    .register('/push-sw.js')
    .then(async (reg) => {
      await navigator.serviceWorker.ready;
      swRegistration = reg;
      console.log('✅ Push service worker registered');
      return reg;
    })
    .catch((error) => {
      console.error('❌ Failed to register push SW:', error);
      registrationPromise = null;
      throw error;
    });

  return registrationPromise;
}

/**
 * Subscribe to Web Push notifications
 */
export async function subscribeToWebPush(vapidPublicKey: string): Promise<PushSubscription> {
  const registration = await getServiceWorkerRegistration();

  let subscription = await registration.pushManager.getSubscription();
  if (subscription) return subscription;

  const urlBase64ToUint8Array = (base64String: string) => {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  };

  subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });

  console.log('✅ Subscribed to Web Push');
  return subscription;
}

/**
 * Auto-register push subscription silently if permission already granted.
 * Saves/updates subscription in push_subscriptions table.
 */
export async function autoRegisterWebPush(): Promise<void> {
  const isSupported = "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
  if (!isSupported) return;

  // Don't prompt — only proceed if already granted
  if (Notification.permission !== "granted") return;

  // Skip in iframe (Lovable preview / Chromecast)
  if (window.self !== window.top) return;

  if (!VAPID_PUBLIC_KEY) {
    console.warn('VITE_VAPID_PUBLIC_KEY not set, skipping push registration');
    return;
  }

  try {
    await getServiceWorkerRegistration();
    const subscription = await subscribeToWebPush(VAPID_PUBLIC_KEY);
    const subscriptionJSON = subscription.toJSON();
    const deviceInfo = navigator.userAgent;

    // Upsert by endpoint
    const { data: existing } = await supabase
      .from('push_subscriptions')
      .select('id')
      .eq('endpoint', subscriptionJSON.endpoint!)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('push_subscriptions')
        .update({ 
          subscription: subscriptionJSON, 
          device_info: deviceInfo,
          last_used_at: new Date().toISOString() 
        })
        .eq('id', existing.id);
    } else {
      await supabase
        .from('push_subscriptions')
        .insert({
          endpoint: subscriptionJSON.endpoint!,
          subscription: subscriptionJSON,
          device_info: deviceInfo,
        });
    }

    console.log('✅ Push subscription registered');
  } catch (error) {
    console.error('Push registration error:', error);
  }
}

/**
 * Request notification permission and register
 */
export async function requestAndRegisterPush(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;
  
  await autoRegisterWebPush();
  return true;
}
