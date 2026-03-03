import * as webpush from 'jsr:@negrel/webpush@0.5.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const action = body.action || 'generate';

    // GET current server VAPID public key
    if (action === 'get_current') {
      const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
      const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');

      if (!vapidPublicKey || !vapidPrivateKey) {
        return new Response(
          JSON.stringify({ error: 'VAPID keys not configured' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        );
      }

      try {
        const publicKeyJWK = JSON.parse(vapidPublicKey);
        const privateKeyJWK = JSON.parse(vapidPrivateKey);

        const vapidKeys = await webpush.importVapidKeys({
          publicKey: publicKeyJWK,
          privateKey: privateKeyJWK,
        }, { extractable: true });

        const publicKeyForBrowser = await webpush.exportApplicationServerKey(vapidKeys);

        return new Response(
          JSON.stringify({ publicKeyForBrowser, isConfigured: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (parseError) {
        return new Response(
          JSON.stringify({ error: 'Invalid VAPID key format', details: String(parseError) }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        );
      }
    }

    // Generate new VAPID keys
    const vapidKeys = await webpush.generateVapidKeys({ extractable: true });
    const exportedKeys = await webpush.exportVapidKeys(vapidKeys);
    const publicKeyForBrowser = await webpush.exportApplicationServerKey(vapidKeys);

    return new Response(
      JSON.stringify({
        message: 'VAPID keys generated successfully',
        instructions: 'Copy these values to secrets',
        secrets: {
          VAPID_PUBLIC_KEY: JSON.stringify(exportedKeys.publicKey),
          VAPID_PRIVATE_KEY: JSON.stringify(exportedKeys.privateKey),
          VITE_VAPID_PUBLIC_KEY: publicKeyForBrowser,
        },
        publicKeyForBrowser,
      }, null, 2),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
