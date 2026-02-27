import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  ProfileStep,
  getEffectiveTargetTemp,
} from '../_shared/temp-utils.ts'
import { insertNotification } from '../_shared/notifications.ts'
import { processStep, StepContext, SgDataPoint } from '../_shared/step-handlers.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

interface Session {
  id: string
  profile_id: string
  brew_id: string | null
  controller_id: string
  status: string
  current_step_index: number
  step_started_at: string
  step_start_temp: number | null
  started_at: string
}

/**
 * Set the profile target temperature in the database.
 * This does NOT write to the RAPT controller — PID owns that.
 */
async function setProfileTarget(
  supabase: ReturnType<typeof createClient>,
  controllerId: string,
  profileTarget: number,
) {
  await supabase
    .from('rapt_temp_controllers')
    .update({ profile_target_temp: profileTarget, updated_at: new Date().toISOString() })
    .eq('controller_id', controllerId)
  console.log(`📋 Profile target set: ${profileTarget}°C for ${controllerId} (PID will enforce)`)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Get all running sessions
    const { data: sessions, error: sessionsError } = await supabase
      .from('fermentation_sessions')
      .select('*')
      .eq('status', 'running')

    if (sessionsError) {
      throw new Error(`Failed to fetch sessions: ${sessionsError.message}`)
    }

    if (!sessions || sessions.length === 0) {
      return new Response(JSON.stringify({ message: 'No active sessions' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const results: { sessionId: string; action: string; details: any }[] = []
    const typedSessions = sessions as Session[]

    // ---- Batch pre-fetch: profile steps, controllers, brew data ----
    const uniqueProfileIds = [...new Set(typedSessions.map(s => s.profile_id))]
    const uniqueControllerIds = [...new Set(typedSessions.map(s => s.controller_id))]
    const brewIds = typedSessions.map(s => s.brew_id).filter((id): id is string => id !== null)

    const [
      { data: allSteps },
      { data: allControllers },
      { data: allBrewData },
      { data: allMetrics },
    ] = await Promise.all([
      supabase
        .from('fermentation_profile_steps')
        .select('*')
        .in('profile_id', uniqueProfileIds)
        .order('step_order', { ascending: true }),
      supabase
        .from('rapt_temp_controllers')
        .select('*')
        .in('controller_id', uniqueControllerIds),
      brewIds.length > 0
        ? supabase
            .from('brew_readings')
            .select('id, sg_data, original_gravity, final_gravity')
            .in('id', brewIds)
        : Promise.resolve({ data: null } as { data: null }),
      brewIds.length > 0
        ? supabase
            .from('brew_fermentation_metrics')
            .select('brew_id, fermentation_phase, activity_score, sg_rate_per_hour, eta_to_fg_hours, ready_to_crash')
            .in('brew_id', brewIds)
        : Promise.resolve({ data: null } as { data: null }),
    ])

    // Group steps by profile_id
    const batchStepsMap = new Map<string, any[]>()
    if (allSteps) {
      for (const step of allSteps) {
        const list = batchStepsMap.get(step.profile_id) || []
        list.push(step)
        batchStepsMap.set(step.profile_id, list)
      }
    }

    // Map controllers by controller_id
    const batchControllerMap = new Map<string, any>()
    if (allControllers) {
      for (const c of allControllers) {
        batchControllerMap.set(c.controller_id, c)
      }
    }

    // Map brew data by brew id
    const batchBrewDataMap = new Map<string, { sg_data: SgDataPoint[]; original_gravity: number; final_gravity: number }>()
    if (allBrewData) {
      for (const b of allBrewData as any[]) {
        batchBrewDataMap.set(b.id, {
          sg_data: b.sg_data as SgDataPoint[],
          original_gravity: parseFloat(String(b.original_gravity ?? 0)),
          final_gravity: parseFloat(String(b.final_gravity ?? 0)),
        })
      }
    }

    // Map fermentation metrics by brew id
    const batchMetricsMap = new Map<string, { fermentation_phase: string; activity_score: number; sg_rate_per_hour: number; eta_to_fg_hours: number | null; ready_to_crash: boolean }>()
    if (allMetrics) {
      for (const m of allMetrics as any[]) {
        batchMetricsMap.set(m.brew_id, {
          fermentation_phase: m.fermentation_phase,
          activity_score: parseFloat(String(m.activity_score)),
          sg_rate_per_hour: parseFloat(String(m.sg_rate_per_hour)),
          eta_to_fg_hours: m.eta_to_fg_hours ? parseFloat(String(m.eta_to_fg_hours)) : null,
          ready_to_crash: m.ready_to_crash,
        })
      }
    }

    for (const session of typedSessions) {
      const steps = batchStepsMap.get(session.profile_id)

      if (!steps || steps.length === 0) {
        console.error(`No steps found for profile ${session.profile_id}`)
        continue
      }

      const currentStep = steps[session.current_step_index] as ProfileStep
      
      if (!currentStep) {
        // All steps completed
        await supabase
          .from('fermentation_sessions')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('id', session.id)

        await supabase.from('fermentation_step_log').insert({
          session_id: session.id,
          step_index: session.current_step_index,
          action: 'completed',
          details: { message: 'Profile completed' },
        })

        // Clear profile_target_temp when profile completes
        await supabase
          .from('rapt_temp_controllers')
          .update({ profile_target_temp: null, updated_at: new Date().toISOString() })
          .eq('controller_id', session.controller_id)

        // Notification for profile completion
        await insertNotification(supabase, {
          type: 'profile_completed',
          title: 'Fermenteringsprofil klar',
          body: `Controller ${session.controller_id} har slutfört sin profil`,
          controller_id: session.controller_id,
          brew_id: session.brew_id,
        })

        // === Learn from completed fermentation ===
        try {
          const sessionDurationHours = (Date.now() - new Date(session.started_at).getTime()) / (1000 * 60 * 60);
          
          const { count: pidAdjCount } = await supabase
            .from('auto_cooling_adjustments')
            .select('id', { count: 'exact', head: true })
            .eq('cooler_controller_id', session.controller_id)
            .gte('created_at', session.started_at);

          const { count: stallBoostCount } = await supabase
            .from('stall_boost_outcomes')
            .select('id', { count: 'exact', head: true })
            .eq('controller_id', session.controller_id)
            .gte('created_at', session.started_at);

          const { data: learnedComps } = await supabase
            .from('controller_learned_compensation')
            .select('convergence_count, latest_avg_error')
            .eq('controller_id', session.controller_id);
          
          const avgError = learnedComps && learnedComps.length > 0
            ? learnedComps.reduce((sum, c) => sum + Math.abs(parseFloat(String(c.latest_avg_error))), 0) / learnedComps.length
            : null;

          await supabase.from('fermentation_learnings').upsert({
            controller_id: session.controller_id,
            parameter_name: 'avg_convergence_error',
            learned_value: avgError ?? 0,
            sample_count: (await supabase.from('fermentation_learnings').select('sample_count').eq('controller_id', session.controller_id).eq('parameter_name', 'avg_convergence_error').maybeSingle()).data?.sample_count ?? 0 + 1,
            last_updated_at: new Date().toISOString(),
          }, { onConflict: 'controller_id,parameter_name' });

          console.log(`🎓 Fermentation learning for ${session.controller_id}: duration=${sessionDurationHours.toFixed(0)}h, adjustments=${pidAdjCount ?? 0}, stall_boosts=${stallBoostCount ?? 0}, avg_error=${avgError?.toFixed(2) ?? 'N/A'}`);
        } catch (learnError) {
          console.error('Error saving fermentation learnings:', learnError);
        }

        results.push({ sessionId: session.id, action: 'completed', details: {} })
        continue
      }

      // Build step context
      const controller = batchControllerMap.get(session.controller_id) ?? null
      const brewData = session.brew_id ? (batchBrewDataMap.get(session.brew_id) ?? null) : null
      const metrics = session.brew_id ? (batchMetricsMap.get(session.brew_id) ?? null) : null

      const stepStartedAt = new Date(session.step_started_at)
      const now = new Date()
      const elapsedHours = (now.getTime() - stepStartedAt.getTime()) / (1000 * 60 * 60)

      const ctx: StepContext = {
        supabase,
        session,
        currentStep,
        steps: steps as ProfileStep[],
        controller,
        brewData,
        metrics,
        elapsedHours,
      }

      // Process the current step via the dispatcher
      const { stepCompleted, actionTaken, actionDetails } = await processStep(ctx)

      // Log action if something happened
      if (actionTaken !== 'checked') {
        await supabase.from('fermentation_step_log').insert({
          session_id: session.id,
          step_index: session.current_step_index,
          action: actionTaken,
          details: actionDetails,
        })
      }

      // Advance to next step if completed
      if (stepCompleted) {
        const nextStepIndex = session.current_step_index + 1
        
        if (nextStepIndex >= steps.length) {
          await supabase
            .from('fermentation_sessions')
            .update({ status: 'completed', completed_at: new Date().toISOString() })
            .eq('id', session.id)

          // Clear profile_target_temp when profile completes
          await supabase
            .from('rapt_temp_controllers')
            .update({ profile_target_temp: null, updated_at: new Date().toISOString() })
            .eq('controller_id', session.controller_id)

          await supabase.from('fermentation_step_log').insert({
            session_id: session.id,
            step_index: nextStepIndex,
            action: 'completed',
            details: { message: 'Profile completed' },
          })

          results.push({ sessionId: session.id, action: 'profile_completed', details: {} })
        } else {
          await supabase
            .from('fermentation_sessions')
            .update({ 
              current_step_index: nextStepIndex, 
              step_started_at: new Date().toISOString(),
              step_start_temp: null
            })
            .eq('id', session.id)

          // Set profile_target_temp immediately for the new step so it owns its target from second one
          const nextStep = steps[nextStepIndex] as ProfileStep | undefined
          if (nextStep) {
            if (nextStep.target_temp !== null && nextStep.target_temp !== undefined) {
              await setProfileTarget(supabase, session.controller_id, nextStep.target_temp)
              console.log(`🎯 Step transition: set profile_target_temp=${nextStep.target_temp}°C (explicit) for step ${nextStepIndex} (${nextStep.step_type})`)
            } else {
              // Step has no explicit target — inherit from previous steps
              const effectiveTarget = getEffectiveTargetTemp(steps as ProfileStep[], nextStepIndex)
              if (effectiveTarget !== null) {
                await setProfileTarget(supabase, session.controller_id, effectiveTarget)
                console.log(`🎯 Step transition: set profile_target_temp=${effectiveTarget}°C (inherited) for step ${nextStepIndex} (${nextStep.step_type})`)
              }
            }
          }

          await supabase.from('fermentation_step_log').insert({
            session_id: session.id,
            step_index: nextStepIndex,
            action: 'started',
            details: { 
              previous_step: currentStep.step_type,
              new_step: steps[nextStepIndex]?.step_type || 'unknown',
            },
          })

          results.push({ 
            sessionId: session.id, 
            action: 'step_advanced', 
            details: { 
              from: session.current_step_index, 
              to: nextStepIndex,
              new_step_type: steps[nextStepIndex]?.step_type || 'unknown',
            } 
          })
        }
      } else {
        results.push({ sessionId: session.id, action: actionTaken, details: actionDetails })
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error processing fermentation profiles:', error)
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
