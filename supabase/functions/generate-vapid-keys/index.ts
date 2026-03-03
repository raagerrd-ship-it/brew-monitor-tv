import * as webpush from 'jsr:@negrel/webpush@0.5.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const action = body.action || 'generate';

    // GET current VAPID public key from DB
    if (action === 'get_current') {
      const { data: row, error } = await supabase
        .from('vapid_keys')
        .select('public_key_base64, created_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !row) {
        return new Response(
          JSON.stringify({ error: 'VAPID keys not configured', isConfigured: false }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
        );
      }

      return new Response(
        JSON.stringify({ publicKeyForBrowser: row.public_key_base64, isConfigured: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Generate new VAPID keys and save to DB
    const vapidKeys = await webpush.generateVapidKeys({ extractable: true });
    const exportedKeys = await webpush.exportVapidKeys(vapidKeys);
    const publicKeyForBrowser = await webpush.exportApplicationServerKey(vapidKeys);

    // Delete old keys and insert new ones
    await supabase.from('vapid_keys').delete().neq('id', '00000000-0000-0000-0000-000000000000');

    const { error: insertError } = await supabase.from('vapid_keys').insert({
      public_key_jwk: exportedKeys.publicKey,
      private_key_jwk: exportedKeys.privateKey,
      public_key_base64: publicKeyForBrowser,
    });

    if (insertError) {
      console.error('Failed to save VAPID keys:', insertError);
      return new Response(
        JSON.stringify({ error: 'Failed to save VAPID keys', details: insertError.message }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    // Also clear all existing push subscriptions since they're bound to the old key
    await supabase.from('push_subscriptions').delete().neq('id', '00000000-0000-0000-0000-000000000000');

    console.log('✅ New VAPID keys generated and saved to DB');

    return new Response(
      JSON.stringify({
        message: 'VAPID keys generated and saved successfully',
        publicKeyForBrowser,
        subscriptionsCleared: true,
      }),
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
