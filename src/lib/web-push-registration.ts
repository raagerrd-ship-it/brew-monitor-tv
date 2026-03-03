import { supabase } from "@/integrations/supabase/client";

let swRegistration: ServiceWorkerRegistration | null = null;
let registrationPromise: Promise<ServiceWorkerRegistration> | null = null;
let cachedVapidKey: string | null = null;

/**
 * Fetch the VAPID public key from the edge function (reads from DB)
 */
async function getVapidPublicKey(): Promise<string | null> {
  if (cachedVapidKey) return cachedVapidKey;

  try {
    const { data, error } = await supabase.functions.invoke('generate-vapid-keys', {
      body: { action: 'get_current' },
    });

    if (error || !data?.publicKeyForBrowser) {
      console.warn('Could not fetch VAPID key:', error || 'no key returned');
      return null;
    }

    cachedVapidKey = data.publicKeyForBrowser;
    return cachedVapidKey;
  } catch (err) {
    console.error('Failed to fetch VAPID key:', err);
    return null;
  }
}

/**
 * Register the push service worker (separate from PWA workbox SW)
 */
export async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  if (swRegistration) return swRegistration;
  if (registrationPromise) return registrationPromise;

  registrationPromise = navigator.serviceWorker.ready
    .then((reg) => {
      swRegistration = reg;
      console.log('✅ Using PWA service worker for push');
      return reg;
    })
    .catch((error) => {
      console.error('❌ Failed to get SW registration:', error);
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

  // @ts-ignore - pushManager exists on ServiceWorkerRegistration in browsers
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

  // @ts-ignore - pushManager exists on ServiceWorkerRegistration in browsers
  subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });

  console.log('✅ Subscribed to Web Push');
  return subscription;
}

/**
 * Auto-register push subscription silently if permission already granted.
 */
export async function autoRegisterWebPush(): Promise<void> {
  const isSupported = "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
  if (!isSupported) return;

  if (Notification.permission !== "granted") return;

  // Skip in iframe (Lovable preview / Chromecast)
  if (window.self !== window.top) return;

  const vapidKey = await getVapidPublicKey();
  if (!vapidKey) {
    console.warn('No VAPID key available, skipping push registration');
    return;
  }

  try {
    await getServiceWorkerRegistration();
    const subscription = await subscribeToWebPush(vapidKey);
    const subscriptionJSON = subscription.toJSON();
    const deviceInfo = navigator.userAgent;

    const subData = subscriptionJSON as unknown as Record<string, unknown>;
    const { data: existing } = await supabase
      .from('push_subscriptions')
      .select('id')
      .eq('endpoint', subscriptionJSON.endpoint!)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('push_subscriptions')
        .update({ 
          subscription: subData as any, 
          device_info: deviceInfo,
          last_used_at: new Date().toISOString() 
        })
        .eq('id', existing.id);
    } else {
      await supabase
        .from('push_subscriptions')
        .insert([{
          endpoint: subscriptionJSON.endpoint!,
          subscription: subData as any,
          device_info: deviceInfo,
        }]);
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
