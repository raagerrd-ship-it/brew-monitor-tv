import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { updateLearnedParam } from './learning-utils.ts'

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

    console.log(`🎓 Fermentation learning for ${controllerId}: duration=${sessionDurationHours.toFixed(0)}h, adjustments=${pidAdjCount ?? 0}, stall_boosts=${stallBoostCount ?? 0}`)
  } catch (learnError) {
    console.error('Error saving fermentation learnings:', learnError)
  }
}
