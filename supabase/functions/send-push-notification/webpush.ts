import * as webpush from 'jsr:@negrel/webpush@0.5.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

async function getVapidKeysFromDB() {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const { data, error } = await supabase
    .from('vapid_keys')
    .select('public_key_jwk, private_key_jwk')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    throw new Error('VAPID keys not found in database');
  }

  return data;
}

export async function sendWebPushNotification(
  subscriptionJson: string | any,
  title: string,
  body: string,
  data: Record<string, string>,
): Promise<{ success: boolean; expired?: boolean }> {
  try {
    const subscription = typeof subscriptionJson === 'string'
      ? JSON.parse(subscriptionJson)
      : subscriptionJson;

    console.log('Sending Web Push to:', subscription.endpoint?.substring(0, 50));

    const dbKeys = await getVapidKeysFromDB();

    const vapidKeys = await webpush.importVapidKeys({
      publicKey: dbKeys.public_key_jwk,
      privateKey: dbKeys.private_key_jwk,
    }, { extractable: false });

    const appServer = await webpush.ApplicationServer.new({
      contactInformation: 'mailto:noreply@brewmonitor.app',
      vapidKeys,
    });

    const subscriber = appServer.subscribe(subscription);

    const payload = JSON.stringify({
      title,
      body,
      data,
      icon: '/brew-icon.png',
      badge: '/brew-icon.png',
    });

    await subscriber.pushTextMessage(payload, { ttl: 86400 });

    console.log('Web push notification sent successfully');
    return { success: true };
  } catch (error: any) {
    console.error('Web push error:', error.message || error);
    if (error.response) {
      const status = error.response.status;
      console.error('Response status:', status);
      if (status === 410) {
        return { success: false, expired: true };
      }
    }
    return { success: false };
  }
}
