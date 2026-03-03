import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendWebPushNotification } from './webpush.ts';

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

    const { title, body, data } = await req.json();

    if (!title || !body) {
      return new Response(
        JSON.stringify({ error: 'title and body are required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Get all push subscriptions
    const { data: subscriptions, error: subError } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, subscription');

    if (subError) {
      console.error('Error fetching subscriptions:', subError);
      throw subError;
    }

    if (!subscriptions || subscriptions.length === 0) {
      console.log('No push subscriptions found');
      return new Response(
        JSON.stringify({ message: 'No subscribers', sent: 0, failed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let successCount = 0;
    let failCount = 0;
    const expiredEndpoints: string[] = [];

    for (const sub of subscriptions) {
      try {
        const result = await sendWebPushNotification(
          sub.subscription,
          title,
          body,
          data || {},
        );

        if (result.success) {
          successCount++;
          await supabase
            .from('push_subscriptions')
            .update({ last_used_at: new Date().toISOString() })
            .eq('id', sub.id);
        } else {
          failCount++;
          if (result.expired) {
            expiredEndpoints.push(sub.endpoint);
          }
        }
      } catch (error) {
        failCount++;
        console.error('Error sending push:', error);
      }
    }

    // Clean up expired subscriptions
    for (const endpoint of expiredEndpoints) {
      console.log('Deleting expired subscription:', endpoint.substring(0, 50));
      await supabase
        .from('push_subscriptions')
        .delete()
        .eq('endpoint', endpoint);
    }

    console.log(`Push notifications: ${successCount} sent, ${failCount} failed, ${expiredEndpoints.length} expired`);

    return new Response(
      JSON.stringify({ sent: successCount, failed: failCount, expired: expiredEndpoints.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in send-push-notification:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
