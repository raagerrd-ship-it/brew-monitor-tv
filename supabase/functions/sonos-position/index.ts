import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-bridge-secret, x-device-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/**
 * Lightweight position-only endpoint.
 * Receives ~5 fields per second from the Sonos bridge and updates only
 * position_ms / playback_state / duration_ms on the current sonos_now_playing row.
 *
 * Heavy work (track metadata, album art, background generation) is handled by
 * sonos-bridge-push which is called only on state changes.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  // Validate bridge secret
  const bridgeSecret = req.headers.get('x-bridge-secret');
  const expectedSecret = Deno.env.get('SONOS_BRIDGE_SECRET');
  if (!expectedSecret || bridgeSecret !== expectedSecret) {
    return new Response(JSON.stringify({ ok: false, reason: 'unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const {
      positionMillis,
      durationMillis,
      playbackState,
      pushedAt,
    } = body;

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Find the latest row to update (singleton-ish — bridge owns one active row)
    const { data: existingRow } = await supabase
      .from('sonos_now_playing')
      .select('id, position_ms, playback_state, position_stale_count, track_name')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!existingRow) {
      // No row yet — bridge hasn't pushed state yet. Nothing to update.
      return new Response(JSON.stringify({ ok: true, skipped: 'no_row' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Compensate for network latency using pushedAt timestamp
    const hasRealPosition = typeof positionMillis === 'number' && positionMillis >= 0;
    const latencyMs = (typeof pushedAt === 'number' && pushedAt > 0)
      ? Math.max(0, Date.now() - pushedAt)
      : 0;
    const compensatedPosition = hasRealPosition ? positionMillis + latencyMs : 0;

    // --- Stale-position detection: bridge reports PLAYING but position is frozen ---
    let effectivePlaybackState = playbackState || existingRow.playback_state || 'PLAYBACK_STATE_PLAYING';
    let newStaleCount = 0;
    const positionFrozen = (
      effectivePlaybackState === 'PLAYBACK_STATE_PLAYING' &&
      existingRow.position_ms != null &&
      hasRealPosition &&
      Math.abs(positionMillis - existingRow.position_ms) < 2000 &&
      existingRow.playback_state === 'PLAYBACK_STATE_PLAYING'
    );
    if (positionFrozen) {
      newStaleCount = (existingRow.position_stale_count ?? 0) + 1;
      if (newStaleCount >= 2) {
        effectivePlaybackState = 'PLAYBACK_STATE_PAUSED';
      }
    }

    const updatePayload: Record<string, any> = {
      position_ms: compensatedPosition,
      playback_state: effectivePlaybackState,
      position_stale_count: newStaleCount,
    };
    if (typeof durationMillis === 'number' && durationMillis > 0) {
      updatePayload.duration_ms = durationMillis;
    }

    await supabase.from('sonos_now_playing')
      .update(updatePayload)
      .eq('id', existingRow.id);

    const duration = Date.now() - startTime;
    return new Response(JSON.stringify({
      ok: true,
      duration_ms: duration,
      position_ms: compensatedPosition,
      state: effectivePlaybackState,
      stale_count: newStaleCount,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    console.error(`[SonosPosition] Error:`, e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});