import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { insertNotification } from "../_shared/notifications.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

import type { SgDataPoint } from '../_shared/types.ts'

type FermentationPhase = 'unknown' | 'lag' | 'exponential' | 'stationary' | 'declining';

function determineFermentationPhase(
  sgData: SgDataPoint[],
  fermentationStartMs: number,
): { phase: FermentationPhase; sgRatePerHour: number } {
  if (sgData.length < 3) return { phase: 'unknown', sgRatePerHour: 0 };

  const sorted = [...sgData].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const now = Date.now();

  // Calculate SG rate over last 12h
  const twelveHoursAgo = now - 12 * 60 * 60 * 1000;
  const recent = sorted.filter(p => new Date(p.date).getTime() > twelveHoursAgo);
  if (recent.length < 2) return { phase: 'unknown', sgRatePerHour: 0 };

  const newest = recent[0];
  const oldest = recent[recent.length - 1];
  const hours = (new Date(newest.date).getTime() - new Date(oldest.date).getTime()) / (1000 * 60 * 60);
  if (hours < 3) return { phase: 'unknown', sgRatePerHour: 0 };

  const sgDrop = oldest.value - newest.value; // positive = fermentation happening
  const sgRatePerHour = sgDrop / hours;
  const sgRatePerDay = sgRatePerHour * 24;

  // Calculate peak rate using sliding window (O(n) instead of O(n²))
  // sorted is newest-first; we need oldest-first for the window
  const chronological = [...sorted].reverse();
  let peakRatePerDay = 0;
  let windowStart = 0;
  for (let windowEnd = 1; windowEnd < chronological.length; windowEnd++) {
    const endTime = new Date(chronological[windowEnd].date).getTime();
    // Advance start pointer until window is <= 18h
    while (windowStart < windowEnd) {
      const spanH = (endTime - new Date(chronological[windowStart].date).getTime()) / (1000 * 60 * 60);
      if (spanH <= 18) break;
      windowStart++;
    }
    const startTime = new Date(chronological[windowStart].date).getTime();
    const h = (endTime - startTime) / (1000 * 60 * 60);
    if (h >= 6) {
      const drop = chronological[windowStart].value - chronological[windowEnd].value;
      const rate = (drop / h) * 24;
      if (rate > peakRatePerDay) peakRatePerDay = rate;
    }
  }

  // Hours since fermentation start
  const hoursSinceStart = (now - fermentationStartMs) / (1000 * 60 * 60);

  // Phase determination
  if (hoursSinceStart < 12 && sgRatePerDay < 0.002) {
    return { phase: 'lag', sgRatePerHour };
  }

  if (peakRatePerDay > 0 && sgRatePerDay > peakRatePerDay * 0.6) {
    return { phase: 'exponential', sgRatePerHour };
  }

  if (sgRatePerDay < 0.001) {
    return { phase: 'stationary', sgRatePerHour };
  }

  return { phase: 'declining', sgRatePerHour };
}

function calculateActivityScore(
  deltas: { delta: number }[],
  peakDelta: number,
  sgRatePerHour: number,
  peakSgRatePerHour: number,
): number {
  // Absolute SG rate floor: below ~0.001/day = essentially no fermentation
  const SG_RATE_FLOOR = 0.00004; // ~0.001 SG/day

  // --- Delta-based score (0-1) ---
  let deltaScore = 0;
  if (deltas.length > 0 && peakDelta > 0) {
    const recentAvg = deltas.slice(0, Math.min(6, deltas.length))
      .reduce((sum, d) => sum + Math.abs(d.delta), 0) / Math.min(6, deltas.length);
    deltaScore = recentAvg / peakDelta;
  }

  // --- SG-rate score (0-1) ---
  // Relative to peak, but also scaled by absolute magnitude
  // A rate of ~0.002/day should not score high even if it equals peak
  const SG_RATE_HIGH = 0.000250; // ~0.006 SG/day = clearly active fermentation
  let sgScore = 0;
  if (peakSgRatePerHour > SG_RATE_FLOOR && sgRatePerHour > SG_RATE_FLOOR) {
    const relativeScore = Math.min(1, sgRatePerHour / peakSgRatePerHour);
    // Absolute magnitude factor: ramps from 0→1 as rate goes from FLOOR→HIGH
    const absoluteFactor = Math.min(1, (sgRatePerHour - SG_RATE_FLOOR) / (SG_RATE_HIGH - SG_RATE_FLOOR));
    sgScore = relativeScore * absoluteFactor;
  }

  // If SG is essentially stopped, activity is 0 — delta only reflects
  // thermal stratification (pill vs probe), not fermentation activity
  if (sgRatePerHour < SG_RATE_FLOOR) {
    return 0;
  }

  // Hybrid: take the higher of the two signals, but weight SG slightly more
  // This ensures high SG activity shows even without a big delta,
  // and vice versa (controller working hard = activity)
  const blended = Math.max(deltaScore * 0.7, sgScore) * 0.6 + Math.min(deltaScore, sgScore) * 0.4;

  return Math.max(0, Math.min(100, Math.round(blended * 100)));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    // Get all actively fermenting brews
    const { data: brews } = await supabase
      .from('brew_readings')
      .select('id, name, sg_data, original_gravity, final_gravity, current_sg, fermentation_start, linked_controller_id, status, attenuation, style')
      .in('status', ['Fermenting', 'Jäsning']);

    if (!brews || brews.length === 0) {
      return new Response(JSON.stringify({ message: 'No fermenting brews', updated: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get existing metrics for all brews
    const brewIds = brews.map(b => b.id);
    const { data: existingMetrics } = await supabase
      .from('brew_fermentation_metrics')
      .select('brew_id, peak_delta, peak_sg_rate_per_hour')
      .in('brew_id', brewIds);

    const existingPeakMap = new Map<string, { peakDelta: number; peakSgRate: number }>();
    (existingMetrics || []).forEach((m: any) => {
      existingPeakMap.set(m.brew_id, {
        peakDelta: parseFloat(String(m.peak_delta)),
        peakSgRate: parseFloat(String(m.peak_sg_rate_per_hour || 0)),
      });
    });

    // Get delta history for all linked controllers
    const controllerIds = brews
      .filter(b => b.linked_controller_id)
      .map(b => b.linked_controller_id!);
    
    const deltaMap = new Map<string, { delta: number }[]>();
    if (controllerIds.length > 0) {
      // Scale limit by number of controllers to get ~200 per device
      const scaledLimit = Math.min(200 * controllerIds.length, 1000);
      const { data: deltas } = await supabase
        .from('temp_delta_history')
        .select('controller_id, delta')
        .in('controller_id', controllerIds)
        .order('recorded_at', { ascending: false })
        .limit(scaledLimit);

      (deltas || []).forEach((d: any) => {
        const list = deltaMap.get(d.controller_id) || [];
        list.push({ delta: parseFloat(String(d.delta)) });
        deltaMap.set(d.controller_id, list);
      });
    }

    // Check for running fermentation sessions (for cold crash readiness)
    const { data: sessions } = await supabase
      .from('fermentation_sessions')
      .select('brew_id, status')
      .eq('status', 'running')
      .in('brew_id', brewIds);

    const sessionBrewIds = new Set((sessions || []).map((s: any) => s.brew_id));

    let updated = 0;
    const upserts: any[] = [];

    for (const brew of brews) {
      const allSgData = (Array.isArray(brew.sg_data) ? brew.sg_data : []) as SgDataPoint[];
      // Trim to last 14 days to reduce computation
      const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
      const sgData = allSgData.filter(p => new Date(p.date).getTime() > fourteenDaysAgo);
      if (sgData.length < 3) continue;

      const fermentationStartMs = brew.fermentation_start
        ? new Date(brew.fermentation_start).getTime()
        : new Date(sgData.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0].date).getTime();

      // Phase & SG rate
      const { phase, sgRatePerHour } = determineFermentationPhase(sgData, fermentationStartMs);

      // Activity score from delta history + SG rate
      const deltas = brew.linked_controller_id ? (deltaMap.get(brew.linked_controller_id) || []) : [];
      const existing = existingPeakMap.get(brew.id) || { peakDelta: 0, peakSgRate: 0 };
      const currentMaxDelta = deltas.length > 0
        ? Math.max(...deltas.map(d => Math.abs(d.delta)))
        : 0;
      const peakDelta = Math.max(existing.peakDelta, currentMaxDelta);
      const peakSgRatePerHour = Math.max(existing.peakSgRate, sgRatePerHour);
      const activityScore = calculateActivityScore(deltas, peakDelta, sgRatePerHour, peakSgRatePerHour);

      // ETA to FG
      const fg = parseFloat(String(brew.final_gravity));
      const currentSg = parseFloat(String(brew.current_sg));
      let etaToFgHours: number | null = null;
      if (sgRatePerHour > 0.00001 && currentSg > fg) {
        etaToFgHours = Math.round((currentSg - fg) / sgRatePerHour);
        // Cap at 30 days to avoid absurd values
        if (etaToFgHours > 720) etaToFgHours = null;
      }

      // Cold crash readiness: SG stable 2+ days, attenuation > 70%, activity low
      const og = parseFloat(String(brew.original_gravity));
      const attRange = og - fg;
      const currentAtt = attRange > 0 ? ((og - currentSg) / attRange) * 100 : 0;
      
      // Check SG stability (last 48h)
      const sorted = [...sgData].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      const fortyEightHoursAgo = Date.now() - 48 * 60 * 60 * 1000;
      const recentSg = sorted.filter(p => new Date(p.date).getTime() > fortyEightHoursAgo);
      let sgStable48h = false;
      if (recentSg.length >= 4) {
        const maxSg = Math.max(...recentSg.map(p => p.value));
        const minSg = Math.min(...recentSg.map(p => p.value));
        sgStable48h = (maxSg - minSg) < 0.002;
      }

      const readyToCrash = sgStable48h && currentAtt > 70 && activityScore < 15 && phase === 'stationary';

      // === Predicted SG curve ===
      // Exponential decay model: SG(t) = FG + (OG - FG) * e^(-k*t)
      const styleLower = (brew.style || '').toLowerCase();
      let k = 0.015; // default
      if (styleLower.includes('lager') || styleLower.includes('pilsner')) k = 0.01;
      else if (styleLower.includes('saison') || styleLower.includes('belgian')) k = 0.025;
      else if (styleLower.includes('ipa') || styleLower.includes('ale')) k = 0.02;

      // Adapt k from actual data if enough points
      if (sgData.length >= 6 && og > fg) {
        const midIdx = Math.floor(sgData.length / 2);
        const midPoint = [...sgData].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[midIdx];
        const midHours = (new Date(midPoint.date).getTime() - fermentationStartMs) / (1000 * 60 * 60);
        const midSg = midPoint.value;
        if (midHours > 6 && midSg < og && midSg > fg) {
          const ratio = (midSg - fg) / (og - fg);
          if (ratio > 0.01 && ratio < 1) {
            const adaptedK = -Math.log(ratio) / midHours;
            k = k * 0.3 + adaptedK * 0.7; // blend
          }
        }
      }

      // Generate 8 points from start to start + 30 days
      const predictedSgCurve: { date: string; sg: number }[] = [];
      const maxHours = 720; // 30 days
      for (let i = 0; i < 8; i++) {
        const t = (i / 7) * maxHours;
        const predictedSg = fg + (og - fg) * Math.exp(-k * t);
        const pointDate = new Date(fermentationStartMs + t * 60 * 60 * 1000).toISOString();
        predictedSgCurve.push({ date: pointDate, sg: Math.round(predictedSg * 10000) / 10000 });
      }

      upserts.push({
        brew_id: brew.id,
        fermentation_phase: phase,
        activity_score: activityScore,
        sg_rate_per_hour: Math.round(sgRatePerHour * 1000000) / 1000000,
        eta_to_fg_hours: etaToFgHours,
        peak_delta: peakDelta,
        peak_sg_rate_per_hour: Math.round(peakSgRatePerHour * 1000000) / 1000000,
        ready_to_crash: readyToCrash,
        ready_to_crash_at: readyToCrash ? new Date().toISOString() : null,
        predicted_sg_curve: predictedSgCurve,
        updated_at: new Date().toISOString(),
      });
    }

    if (upserts.length > 0) {
      const { error } = await supabase
        .from('brew_fermentation_metrics')
        .upsert(upserts, { onConflict: 'brew_id' });

      if (error) {
        console.error('Error upserting metrics:', error);
      } else {
        updated = upserts.length;
      }
    }

    // Log READY_TO_CRASH events
    const readyBrews = upserts.filter(u => u.ready_to_crash);
    for (const rb of readyBrews) {
      if (sessionBrewIds.has(rb.brew_id)) {
        const { data: existingLog } = await supabase
          .from('fermentation_step_log')
          .select('id')
          .eq('action', 'ready_to_crash')
          .in('session_id', (sessions || []).filter((s: any) => s.brew_id === rb.brew_id).map((s: any) => s.id))
          .limit(1);

        if (!existingLog || existingLog.length === 0) {
          const session = (sessions || []).find((s: any) => s.brew_id === rb.brew_id);
          if (session) {
            await supabase.from('fermentation_step_log').insert({
              session_id: session.id,
              step_index: 0,
              action: 'ready_to_crash',
              details: {
                phase: rb.fermentation_phase,
                activity_score: rb.activity_score,
                message: 'Redo för cold crash - SG stabil, låg aktivitet',
              },
            });

            // Normal event — no notification needed

            console.log(`🧊 READY_TO_CRASH logged for brew ${rb.brew_id}`);
          }
        }
      }
    }

    console.log(`Computed metrics for ${updated} brews: ${upserts.map(u => `${u.fermentation_phase}(${u.activity_score}%)`).join(', ')}`);

    return new Response(
      JSON.stringify({ ok: true, updated, metrics: upserts.map(u => ({ brew_id: u.brew_id, phase: u.fermentation_phase, activity: u.activity_score, eta_h: u.eta_to_fg_hours })) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error('Error computing fermentation metrics:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
