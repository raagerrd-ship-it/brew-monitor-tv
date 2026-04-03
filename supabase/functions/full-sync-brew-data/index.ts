import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'npm:@supabase/supabase-js@2.58.0'

// ── RAPT auth with DB token cache (same strategy as quick-sync) ──
async function getRaptTokenCached(supabase: any): Promise<string> {
  try {
    const { data: cached } = await supabase
      .from('rapt_token_cache')
      .select('access_token, expires_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (cached?.access_token && cached?.expires_at) {
      const expiresAt = new Date(cached.expires_at).getTime();
      if (expiresAt > Date.now() + 10 * 60 * 1000) {
        console.log('🔑 [full-sync] Using cached RAPT token (expires in ' + Math.round((expiresAt - Date.now()) / 60000) + 'min)');
        return cached.access_token;
      }
    }
  } catch (e) { console.log('Token cache read failed, authenticating fresh'); }

  const RAPT_USERNAME = Deno.env.get('RAPT_USERNAME');
  const RAPT_API_SECRET = Deno.env.get('RAPT_API_SECRET');
  if (!RAPT_USERNAME || !RAPT_API_SECRET) throw new Error('RAPT credentials not configured');

  const formData = new URLSearchParams();
  formData.append('client_id', 'rapt-user');
  formData.append('grant_type', 'password');
  formData.append('username', RAPT_USERNAME);
  formData.append('password', RAPT_API_SECRET);

  const authBaseUrl = Deno.env.get('RAPT_AUTH_BASE_URL') || 'https://id.rapt.io';
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${authBaseUrl}/connect/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString(),
        signal: AbortSignal.timeout(45000),
      });
      if (!res.ok) throw new Error(`RAPT auth error: ${res.status}`);
      const data = await res.json();

      if (data.expires_in) {
        const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
        await supabase.from('rapt_token_cache')
          .upsert({ id: '00000000-0000-0000-0000-000000000001', access_token: data.access_token, expires_at: expiresAt }, { onConflict: 'id' });
        console.log('🔑 [full-sync] Fresh RAPT token cached');
      }
      return data.access_token;
    } catch (e) {
      lastError = e as Error;
      if (attempt === 0) console.log(`🔑 [full-sync] Auth attempt 1 failed, retrying...`);
    }
  }
  throw lastError!;
}

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

    console.log('Starting FULL sync (RAPT discovery + quick sync + AI audit)...')

    // Update timestamps
    const { data: syncSettings } = await supabase.from('sync_settings')
      .select('id')
      .limit(1).single();

    if (syncSettings?.id) {
      const nowIso = new Date().toISOString()
      supabase.from('sync_settings').update({
        last_sync_time: nowIso,
        last_full_sync_at: nowIso
      }).eq('id', syncSettings.id).then(({ error }: any) => {
        if (error) console.error('sync_settings update error:', error)
      })
    }

    // ──────────────────────────────────────────────────────
    // STEP 1: Get RAPT token ONCE, then run discovery + quick sync
    // ──────────────────────────────────────────────────────

    let raptToken: string | null = null;
    try {
      raptToken = await getRaptTokenCached(supabase);
    } catch (e) {
      console.error('RAPT auth failed (discovery + quick sync will use their own fallback):', e);
    }

    // discover: true merges auto-discovery into the same function call — halves RAPT GET requests
    console.log('Running quick sync pass with discovery (data + automation)...')
    try {
      // Write a reservation log entry so cron-triggered quick-syncs skip (concurrency guard)
      await supabase.from('auto_cooling_decision_logs').insert({
        duration_ms: 0,
        decision_count: 0,
        decisions: [{ type: 'FULL_SYNC_RESERVATION', message: 'Reserved by full-sync to prevent cron overlap' }],
        adjustment_made: false,
        final_result: 'full-sync reservation',
      });

      await supabase.functions.invoke('sync-rapt-data-quick', { 
        body: { 
          access_token: raptToken || undefined, 
          from_full_sync: true,
          discover: true,
        } 
      })
      console.log('Quick sync pass with discovery completed')
    } catch (e) {
      console.error('Quick sync pass failed:', e)
    }

    // ──────────────────────────────────────────────────────
    // STEP 2: AI audit (with idle detection)
    // ──────────────────────────────────────────────────────

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

    console.log('FULL sync completed')

    return new Response(
      JSON.stringify({ message: 'Full sync completed' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error in full-sync-brew-data:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
