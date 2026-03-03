import * as webpush from 'jsr:@negrel/webpush@0.5.0';

export async function sendWebPushNotification(
  subscriptionJson: string | any,
  title: string,
  body: string,
  data: Record<string, string>,
  vapidPublicKey: string,
  vapidPrivateKey: string
): Promise<{ success: boolean; expired?: boolean }> {
  try {
    const subscription = typeof subscriptionJson === 'string'
      ? JSON.parse(subscriptionJson)
      : subscriptionJson;

    console.log('Sending Web Push to:', subscription.endpoint?.substring(0, 50));

    const extractJSON = (str: string): string => {
      const firstBrace = str.indexOf('{');
      const lastBrace = str.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1) {
        return str.substring(firstBrace, lastBrace + 1);
      }
      return str;
    };

    const publicKeyObj = typeof vapidPublicKey === 'string'
      ? JSON.parse(extractJSON(vapidPublicKey))
      : vapidPublicKey;

    const privateKeyObj = typeof vapidPrivateKey === 'string'
      ? JSON.parse(extractJSON(vapidPrivateKey))
      : vapidPrivateKey;

    const vapidKeys = await webpush.importVapidKeys({
      publicKey: publicKeyObj,
      privateKey: privateKeyObj,
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
