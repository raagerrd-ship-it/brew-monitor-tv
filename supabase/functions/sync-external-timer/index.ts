import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TimerMilestone {
  time: number;
  label: string;
  triggered?: boolean;
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
    const externalSupabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inptdmt2cG13cHl4ZHBieXNvbXhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzE5NTY5MTQsImV4cCI6MjA0NzUzMjkxNH0.56BpImKxp-D_x7l8x5J5d_7mMxGJvSY3L5S5CyVBNjE';
    
    const externalSupabase = createClient(externalSupabaseUrl, externalSupabaseKey);

    // Sign in to external Supabase
    console.log('🔐 Signing in to external Supabase...');
    const { data: authData, error: authError } = await externalSupabase.auth.signInWithPassword({
      email: externalEmail,
      password: externalPassword,
    });

    if (authError || !authData.session) {
      console.error('❌ Auth error:', authError?.message);
      return new Response(
        JSON.stringify({ error: 'Authentication failed', details: authError?.message }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = authData.user.id;
    const accessToken = authData.session.access_token;
    console.log('✅ Authenticated as user:', userId);

    // Fetch timer data from external API
    console.log('📡 Fetching timer data...');
    const timerResponse = await fetch(
      `${externalSupabaseUrl}/functions/v1/get-active-timer`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!timerResponse.ok) {
      console.error('❌ Timer fetch error:', timerResponse.statusText);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch timer', details: timerResponse.statusText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const timerData = await timerResponse.json();
    console.log('📊 Timer data received:', {
      isActive: timerData?.isActive,
      label: timerData?.label,
      remainingSeconds: timerData?.remainingSeconds,
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
      milestones: milestones,
      next_milestone: timerData?.nextMilestone || null,
      time_to_next_milestone: timerData?.timeToNextMilestone || null,
      progress: timerData?.progress || 0,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Check if record exists
    const { data: existing } = await localSupabase
      .from('cached_external_timer')
      .select('id')
      .eq('external_user_id', userId)
      .maybeSingle();

    if (existing) {
      // Update existing record
      const { error: updateError } = await localSupabase
        .from('cached_external_timer')
        .update(timerRecord)
        .eq('external_user_id', userId);

      if (updateError) {
        console.error('❌ Update error:', updateError.message);
        return new Response(
          JSON.stringify({ error: 'Failed to update cache', details: updateError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      console.log('✅ Timer cache updated');
    } else {
      // Insert new record
      const { error: insertError } = await localSupabase
        .from('cached_external_timer')
        .insert([timerRecord]);

      if (insertError) {
        console.error('❌ Insert error:', insertError.message);
        return new Response(
          JSON.stringify({ error: 'Failed to insert cache', details: insertError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      console.log('✅ Timer cache created');
    }

    // Sign out from external Supabase
    await externalSupabase.auth.signOut();

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