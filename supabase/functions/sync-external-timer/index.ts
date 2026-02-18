import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface TimerMilestone {
  time: number;
  atSeconds?: number;
  label: string;
  triggered?: boolean;
  acknowledged?: boolean;
  pauseForTemperature?: boolean;
  targetTemperature?: number;
  whirlpoolTime?: number;
}

interface NextConfig {
  label: string;
  minutes: number;
  navigateTo?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  console.log('🔄 Starting external timer sync...');

  try {
    // Get credentials from secrets
    const externalEmail = Deno.env.get('EXTERNAL_SUPABASE_EMAIL');
    const externalPassword = Deno.env.get('EXTERNAL_SUPABASE_PASSWORD');
    
    if (!externalEmail || !externalPassword) {
      console.error('❌ Missing external credentials');
      return new Response(
        JSON.stringify({ error: 'Missing external credentials' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize external Supabase client
    const externalSupabaseUrl = 'https://zmvkvpmwpyxdpbysomxl.supabase.co';
    const externalSupabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inptdmt2cG13cHl4ZHBieXNvbXhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM0OTQ2NTMsImV4cCI6MjA3OTA3MDY1M30.IC1xZyB_mphskudaRgMKNPQYvkwkNMsiXlsuYmlsiMY';
    
    const externalSupabase = createClient(externalSupabaseUrl, externalSupabaseKey);

    // Sign in to external Supabase
    console.log('🔐 Signing in to external Supabase...');
    const { data: authData, error: authError } = await externalSupabase.auth.signInWithPassword({
      email: externalEmail,
      password: externalPassword,
    });

    if (authError || !authData.session) {
      const isTransient = authError?.message?.includes('connection') || 
                          authError?.message?.includes('reset') ||
                          authError?.message?.includes('timeout') ||
                          authError?.message?.includes('SendRequest');
      if (isTransient) {
        console.warn('⚠️ Transient auth error, skipping sync cycle:', authError?.message);
        return new Response(
          JSON.stringify({ success: false, skipped: true, reason: 'transient_auth_error' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      console.error('❌ Auth error:', authError?.message);
      return new Response(
        JSON.stringify({ error: 'Authentication failed', details: authError?.message }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = authData.user.id;
    const accessToken = authData.session.access_token;
    console.log('✅ Authenticated as user:', userId);

    // Fetch timer data from new brewing status endpoint
    console.log('📡 Fetching brewing status...');
    const timerResponse = await fetch(
      `${externalSupabaseUrl}/functions/v1/get-brewing-status`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!timerResponse.ok) {
      // Don't return 500 for auth race conditions — just skip this sync cycle
      console.warn('⚠️ Timer fetch returned:', timerResponse.status, timerResponse.statusText);
      return new Response(
        JSON.stringify({ success: false, skipped: true, reason: timerResponse.statusText }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const responseData = await timerResponse.json();
    const timerData = responseData?.timer;
    const wizardData = responseData?.wizard;
    
    console.log('📊 Brewing status received:', {
      isActive: timerData?.isActive,
      label: timerData?.label,
      remainingSeconds: timerData?.remainingSeconds,
      wizardStep: wizardData?.step,
      recipeName: responseData?.recipeName,
    });

    // Initialize local Supabase client
    const localSupabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const localSupabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const localSupabase = createClient(localSupabaseUrl, localSupabaseKey);

    // Prepare timer record
    const milestones: TimerMilestone[] = Array.isArray(timerData?.milestones)
      ? timerData.milestones
      : [];

    const timerRecord = {
      external_user_id: userId,
      is_active: timerData?.isActive || false,
      label: timerData?.label || null,
      remaining_seconds: timerData?.remainingSeconds || 0,
      total_seconds: timerData?.totalSeconds || 0,
      is_paused: timerData?.isPaused || false,
      paused_by_milestone: timerData?.pausedByMilestone || false,
      paused_at: timerData?.pausedAt || null,
      milestones: milestones,
      next_milestone: timerData?.nextMilestone || null,
      time_to_next_milestone: timerData?.timeToNextMilestone || null,
      progress: timerData?.progress || 0,
      next_config: timerData?.nextConfig || null,
      wizard_step: wizardData?.step || null,
      wizard_started_at: wizardData?.startedAt || null,
      recipe_name: responseData?.recipeName || null,
      beer_style: responseData?.beerStyle || null,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Upsert to avoid race conditions with concurrent calls
    const { error: upsertError } = await localSupabase
      .from('cached_external_timer')
      .upsert(timerRecord, { onConflict: 'external_user_id' });

    if (upsertError) {
      const msg = upsertError.message || '';
      const isTransient = msg.includes('connection') ||
                          msg.includes('reset') ||
                          msg.includes('timeout') ||
                          msg.includes('SendRequest') ||
                          msg.includes('<!DOCTYPE') ||
                          msg.includes('Internal server error') ||
                          msg.includes('cloudflare');
      if (isTransient) {
        console.warn('⚠️ Transient upsert error, skipping sync cycle:', upsertError.message);
        return new Response(
          JSON.stringify({ success: false, skipped: true, reason: 'transient_upsert_error' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      console.error('❌ Upsert error:', upsertError.message);
      return new Response(
        JSON.stringify({ error: 'Failed to upsert cache', details: upsertError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    console.log('✅ Timer cache updated');

    // Don't sign out — concurrent calls would invalidate each other's sessions

    return new Response(
      JSON.stringify({
        success: true,
        isActive: timerData?.isActive || false,
        label: timerData?.label || null,
        remainingSeconds: timerData?.remainingSeconds || 0,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('❌ Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Unexpected error', details: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
