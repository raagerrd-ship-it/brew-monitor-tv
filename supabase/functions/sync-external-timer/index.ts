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
  current?: boolean;
  acknowledged?: boolean;
  pauseForTemperature?: boolean;
  targetTemperature?: number;
  whirlpoolTime?: number;
  action?: string;
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
      const authMsg = (authError?.message || '').toLowerCase();
      const isTransient = authMsg.includes('connection') ||
                          authMsg.includes('reset') ||
                          authMsg.includes('timeout') ||
                          authMsg.includes('timed out') ||
                          authMsg.includes('gateway') ||
                          authMsg.includes('unavailable') ||
                          authMsg.includes('sendrequest');
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

    // Local Supabase client (used by both paths below)
    const localSupabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const localSupabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const localSupabase = createClient(localSupabaseUrl, localSupabaseKey);

    // Preferred source: shared_brewing_session (brew app is the single writer)
    const { data: sessionRow, error: sessionError } = await externalSupabase
      .from('shared_brewing_session')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (sessionError) {
      console.warn('⚠️ shared_brewing_session read failed, falling back:', sessionError.message);
    }

    if (sessionRow) {
      const milestones: TimerMilestone[] = Array.isArray(sessionRow.timer_milestones)
        ? sessionRow.timer_milestones
        : [];

      const label: string | null = sessionRow.timer_label ?? null;
      const totalSeconds = Math.max(0, Math.round((sessionRow.timer_total_ms ?? 0) / 1000));
      const pausedAtMs: number | null = sessionRow.timer_paused_at ?? null;
      const isPaused = pausedAtMs !== null;

      let remainingSeconds = isPaused
        ? Math.max(0, Math.round((sessionRow.timer_remaining_ms ?? 0) / 1000))
        : Math.max(0, Math.round(((sessionRow.timer_end_time ?? 0) - Date.now()) / 1000));
      // Not-yet-started steps must show full length, never 0
      if (totalSeconds > 0 && remainingSeconds > totalSeconds) remainingSeconds = totalSeconds;

      // "Now" = the milestone flagged current by the brew app. Never guessed.
      // `triggered` remains a legacy fallback only.
      const current = milestones.find((m) => (m as Record<string, unknown>).current === true)
        ?? (milestones
          .filter((m) => m.triggered === true)
          .sort((a, b) => (b.time ?? 0) - (a.time ?? 0))[0] ?? null);
      // "Next" = upcoming milestone that happens soonest (largest time among the rest)
      const next = milestones
        .filter((m) =>
          m !== current &&
          (m as Record<string, unknown>).current !== true &&
          m.triggered !== true &&
          (m.time ?? 0) < remainingSeconds
        )
        .sort((a, b) => (b.time ?? 0) - (a.time ?? 0))[0] ?? null;

      const pausesHere = !!current && (current.pauseForTemperature === true || (current as Record<string, unknown>).pauseHere === true);
      const acked = !!current && (current.acknowledged === true || (current as Record<string, unknown>).ack === true);

      const record = {
        external_user_id: userId,
        is_active: !!label,
        label,
        remaining_seconds: remainingSeconds,
        total_seconds: totalSeconds,
        is_paused: isPaused,
        paused_by_milestone: isPaused && pausesHere && !acked,
        paused_at: pausedAtMs ? new Date(pausedAtMs).toISOString() : null,
        milestones,
        next_milestone: next,
        time_to_next_milestone: next ? Math.max(0, remainingSeconds - (next.time ?? 0)) : null,
        progress: totalSeconds > 0 ? ((totalSeconds - remainingSeconds) / totalSeconds) * 100 : 0,
        next_config: null,
        timer_action: typeof current?.action === 'string' ? current.action : null,
        timer_target_temperature: typeof current?.targetTemperature === 'number' ? current.targetTemperature : null,
        wizard_step: sessionRow.wizard_step ?? null,
        wizard_started_at: null,
        recipe_name: sessionRow.profile_name ?? null,
        beer_style: sessionRow.beer_style ?? null,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { error: sharedUpsertError } = await localSupabase
        .from('cached_external_timer')
        .upsert(record, { onConflict: 'external_user_id' });

      if (sharedUpsertError) {
        console.warn('⚠️ Upsert error (shared session):', sharedUpsertError.message);
        return new Response(
          JSON.stringify({ success: false, skipped: true, reason: 'upsert_error' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('✅ Timer cache updated from shared_brewing_session');
      return new Response(
        JSON.stringify({ success: true, source: 'shared_brewing_session', isActive: !!label, label, remainingSeconds }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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

    // Prepare timer record
    const milestones: TimerMilestone[] = Array.isArray(timerData?.milestones)
      ? timerData.milestones
      : [];

    // Infer paused_by_milestone when the upstream endpoint omits it but the
    // timer is paused at a pauseForTemperature milestone (orange-glow signal).
    const remainingSeconds = timerData?.remainingSeconds || 0;
    const inferredPausedByMilestone =
      timerData?.isPaused === true &&
      milestones.some(
        (m) => m?.pauseForTemperature === true && typeof m?.time === 'number' && m.time >= remainingSeconds,
      );

    const timerRecord = {
      external_user_id: userId,
      is_active: timerData?.isActive || false,
      label: timerData?.label || null,
      remaining_seconds: timerData?.remainingSeconds || 0,
      total_seconds: timerData?.totalSeconds || 0,
      is_paused: timerData?.isPaused || false,
      paused_by_milestone: timerData?.pausedByMilestone || inferredPausedByMilestone || false,
      paused_at: timerData?.pausedAt ? (typeof timerData.pausedAt === 'number' ? new Date(timerData.pausedAt).toISOString() : timerData.pausedAt) : null,
      milestones: milestones,
      next_milestone: timerData?.nextMilestone || null,
      time_to_next_milestone: timerData?.timeToNextMilestone || null,
      progress: timerData?.progress || 0,
      next_config: timerData?.nextConfig || null,
      timer_action: typeof timerData?.action === 'string' ? timerData.action : null,
      timer_target_temperature: typeof timerData?.targetTemperature === 'number' ? timerData.targetTemperature : null,
      wizard_step: wizardData?.step || null,
      wizard_started_at: wizardData?.startedAt ? (typeof wizardData.startedAt === 'number' ? new Date(wizardData.startedAt).toISOString() : wizardData.startedAt) : null,
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
