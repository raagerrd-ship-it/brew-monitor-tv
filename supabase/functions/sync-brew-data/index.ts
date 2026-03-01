// DEPRECATED: This function is fully redundant with sync-rapt-data-quick.
// Kept as a thin redirect so any existing cron jobs or callers still work.
// The cron trigger_brew_sync should be updated to call sync-rapt-data-quick directly.

import { createClient } from 'npm:@supabase/supabase-js@2.58.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    console.log('sync-brew-data called — redirecting to sync-rapt-data-quick (this function is deprecated)')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const result = await supabase.functions.invoke('sync-rapt-data-quick', { body: {} })
    
    return new Response(
      JSON.stringify({ message: 'Redirected to sync-rapt-data-quick (deprecated)', result: result.data }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error in deprecated sync-brew-data:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
