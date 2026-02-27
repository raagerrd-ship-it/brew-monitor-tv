import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * Save fermentation learnings when a profile completes.
 * Aggregates PID adjustments, stall boosts, and convergence errors.
 */
export async function saveFermentationLearnings(
  supabase: ReturnType<typeof createClient>,
  controllerId: string,
  sessionStartedAt: string,
): Promise<void> {
  try {
    const sessionDurationHours = (Date.now() - new Date(sessionStartedAt).getTime()) / (1000 * 60 * 60)

    const [
      { count: pidAdjCount },
      { count: stallBoostCount },
      { data: learnedComps },
    ] = await Promise.all([
      supabase
        .from('auto_cooling_adjustments')
        .select('id', { count: 'exact', head: true })
        .eq('cooler_controller_id', controllerId)
        .gte('created_at', sessionStartedAt),
      supabase
        .from('stall_boost_outcomes')
        .select('id', { count: 'exact', head: true })
        .eq('controller_id', controllerId)
        .gte('created_at', sessionStartedAt),
      supabase
        .from('controller_learned_compensation')
        .select('convergence_count, latest_avg_error')
        .eq('controller_id', controllerId),
    ])

    const avgError = learnedComps && learnedComps.length > 0
      ? learnedComps.reduce((sum, c) => sum + Math.abs(parseFloat(String(c.latest_avg_error))), 0) / learnedComps.length
      : null

    // Fix: wrap ?? 0 in parens before + 1 to avoid operator precedence bug
    const { data: existing } = await supabase
      .from('fermentation_learnings')
      .select('sample_count')
      .eq('controller_id', controllerId)
      .eq('parameter_name', 'avg_convergence_error')
      .maybeSingle()

    const newSampleCount = (existing?.sample_count ?? 0) + 1

    await supabase.from('fermentation_learnings').upsert({
      controller_id: controllerId,
      parameter_name: 'avg_convergence_error',
      learned_value: avgError ?? 0,
      sample_count: newSampleCount,
      last_updated_at: new Date().toISOString(),
    }, { onConflict: 'controller_id,parameter_name' })

    console.log(`🎓 Fermentation learning for ${controllerId}: duration=${sessionDurationHours.toFixed(0)}h, adjustments=${pidAdjCount ?? 0}, stall_boosts=${stallBoostCount ?? 0}, avg_error=${avgError?.toFixed(2) ?? 'N/A'}`)
  } catch (learnError) {
    console.error('Error saving fermentation learnings:', learnError)
  }
}
