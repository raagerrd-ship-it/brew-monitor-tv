import "https://deno.land/x/xhr@0.1.0/mod.ts";
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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    console.log('Starting AI consultation...')

    // Update timestamp
    const { data: syncSettings } = await supabase.from('sync_settings')
      .select('id')
      .limit(1).single();

    if (syncSettings?.id) {
      const nowIso = new Date().toISOString()
      await supabase.from('sync_settings').update({
        last_full_sync_at: nowIso
      }).eq('id', syncSettings.id)
    }

    // Run AI audit
    const { data: autoCoolingSettings } = await supabase
      .from('auto_cooling_settings')
      .select('ai_audit_enabled')
      .limit(1).maybeSingle()

    if (autoCoolingSettings?.ai_audit_enabled) {
      console.log('Running AI audit...')
      try {
        await supabase.functions.invoke('ai-fermentation-advisor', { body: { auto: true } })
        console.log('AI audit completed')
      } catch (e) {
        console.error('AI audit failed:', e)
      }
    } else {
      console.log('AI audit disabled, skipping')
    }

    console.log('AI consultation completed')

    return new Response(
      JSON.stringify({ message: 'AI consultation completed' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error in ai-consultation:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
