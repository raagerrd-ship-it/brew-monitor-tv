// DEPRECATED: This function is fully redundant with the tempHistoryTask in sync-rapt-data-quick.
// Kept as a no-op so any existing cron jobs don't fail.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  console.log('record-temp-history called — this function is deprecated. Temp history is now recorded by sync-rapt-data-quick.');

  return new Response(JSON.stringify({ 
    message: 'Deprecated: temp history is now recorded by sync-rapt-data-quick',
    deprecated: true
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
