import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  ProfileStep,
  getEffectiveTargetTemp,
} from '../_shared/temp-utils.ts'
import { insertNotification } from '../_shared/notifications.ts'

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

interface SgDataPoint {
  date: string
  value: number
  temp: number
}

// Check if gravity has been stable for the required number of days
function isGravityStable(sgData: SgDataPoint[], stableDays: number, threshold: number): boolean {
  if (!sgData || sgData.length < 2) return false
  
  const sortedData = [...sgData].sort((a, b) => 
    new Date(b.date).getTime() - new Date(a.date).getTime()
  )
  
  const currentSg = sortedData[0].value
  let stableFromDate = new Date(sortedData[0].date)
  
  for (let i = 1; i < sortedData.length; i++) {
    const reading = sortedData[i]
    if (reading.value > currentSg + threshold) {
      break
    }
    stableFromDate = new Date(reading.date)
  }
  
  const now = new Date()
  const stableHours = (now.getTime() - stableFromDate.getTime()) / (1000 * 60 * 60)
  const stableDaysActual = stableHours / 24
  
  console.log(`Gravity stability: current SG ${currentSg.toFixed(4)}, stable since ${stableFromDate.toISOString()}, ${stableDaysActual.toFixed(2)} days (need ${stableDays} days)`)
  
  return stableDaysActual >= stableDays
}

// Check if SG condition is met
function isSgConditionMet(sgData: SgDataPoint[], targetSg: number, comparison: string): boolean {
  if (!sgData || sgData.length === 0) return false
  
  const sortedData = [...sgData].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  const latestSg = sortedData[0].value
  
  if (comparison === 'at_or_below') {
    return latestSg <= targetSg
  } else if (comparison === 'at_or_above') {
    return latestSg >= targetSg
  }
  
  return false
}

// Calculate the target temperature for a linear ramp
function calculateRampTemp(startTemp: number, endTemp: number, durationHours: number, elapsedHours: number): number {
  if (elapsedHours >= durationHours) return endTemp
  const progress = elapsedHours / durationHours
  return Math.round((startTemp + (endTemp - startTemp) * progress) * 10) / 10
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
      // Get profile steps from batched data
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

      // Get controller data from batched data
      const controller = batchControllerMap.get(session.controller_id) ?? null

      // Get brew data from batched data
      const brewData = session.brew_id ? (batchBrewDataMap.get(session.brew_id) ?? null) : null

      const stepStartedAt = new Date(session.step_started_at)
      const now = new Date()
      const elapsedHours = (now.getTime() - stepStartedAt.getTime()) / (1000 * 60 * 60)

      let stepCompleted = false
      let actionTaken = 'checked'
      let actionDetails: any = {}

      // For steps without explicit target_temp, set profile target from previous steps
      if (currentStep.target_temp === null && controller) {
        const effectiveTarget = getEffectiveTargetTemp(steps as ProfileStep[], session.current_step_index)
        if (effectiveTarget !== null) {
          // Only update if changed
          const currentProfileTarget = controller.profile_target_temp ? parseFloat(String(controller.profile_target_temp)) : null
          if (currentProfileTarget === null || Math.abs(currentProfileTarget - effectiveTarget) > 0.05) {
            await setProfileTarget(supabase, session.controller_id, effectiveTarget)
            actionTaken = 'profile_target_set'
            actionDetails = { profile_target: effectiveTarget, step_type: currentStep.step_type }
          }
        }
      }

      switch (currentStep.step_type) {
        case 'hold': {
          if (currentStep.target_temp !== null) {
            // Set profile target — PID will handle the actual controller temperature
            const currentProfileTarget = controller?.profile_target_temp ? parseFloat(String(controller.profile_target_temp)) : null
            if (currentProfileTarget === null || Math.abs(currentProfileTarget - currentStep.target_temp) > 0.05) {
              await setProfileTarget(supabase, session.controller_id, currentStep.target_temp)
              actionTaken = 'profile_target_set'
              actionDetails = { profile_target: currentStep.target_temp, step_type: 'hold' }
            }
          }
          
          let durationComplete = false
          let sgTargetMet = false
          
          if (currentStep.duration_hours && elapsedHours >= currentStep.duration_hours) {
            durationComplete = true
          }
          
          if (brewData && currentStep.target_sg !== null && currentStep.sg_comparison) {
            sgTargetMet = isSgConditionMet(brewData.sg_data, currentStep.target_sg, currentStep.sg_comparison)
            if (sgTargetMet) {
              const sortedData = [...brewData.sg_data].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
              actionDetails = { 
                ...actionDetails,
                condition: 'sg_reached', 
                target_sg: currentStep.target_sg, 
                current_sg: sortedData[0]?.value,
                comparison: currentStep.sg_comparison 
              }
              console.log(`Hold step: SG target met - current ${sortedData[0]?.value} ${currentStep.sg_comparison} ${currentStep.target_sg}`)
            }
          }
          
          const holdEffectiveTarget = currentStep.target_temp ?? getEffectiveTargetTemp(steps as ProfileStep[], session.current_step_index)
          const holdCheckTemp = controller?.pill_temp ?? controller?.current_temp ?? null
          const holdTempOk = !holdEffectiveTarget || !controller || 
            (holdCheckTemp !== null && Math.abs(holdCheckTemp - holdEffectiveTarget) <= 0.3)
          
          if (!holdTempOk) {
            console.log(`Hold step: condition met but temp not at target (current ${controller?.current_temp}°C, target ${holdEffectiveTarget}°C) - waiting`)
          }
          
          if (currentStep.duration_hours && currentStep.target_sg !== null) {
            stepCompleted = (durationComplete || sgTargetMet) && holdTempOk
          } else if (currentStep.duration_hours) {
            stepCompleted = durationComplete && holdTempOk
          } else if (currentStep.target_sg !== null) {
            stepCompleted = sgTargetMet && holdTempOk
          }
          
          if (stepCompleted && sgTargetMet) {
            actionTaken = 'condition_met'
          }
          
          break
        }

        case 'ramp': {
          if (currentStep.target_temp === null) break

          if (currentStep.ramp_type === 'immediate') {
            // Set profile target to final ramp temp — PID will handle the actual controller
            await setProfileTarget(supabase, session.controller_id, currentStep.target_temp)
            
            const immStartTemp = session.step_start_temp ?? controller?.target_temp ?? currentStep.target_temp
            const immRampingUp = currentStep.target_temp > immStartTemp
            const immRampCheckTemp = immRampingUp
              ? (controller?.pill_temp ?? controller?.current_temp ?? null)
              : (controller?.current_temp ?? controller?.pill_temp ?? null)
            if (controller && immRampCheckTemp !== null &&
                Math.abs(immRampCheckTemp - currentStep.target_temp) <= 0.3) {
              stepCompleted = true
              actionTaken = 'temp_reached'
              actionDetails = { target_temp: currentStep.target_temp, current_temp: immRampCheckTemp }
              console.log(`Immediate ramp complete: temp ${immRampCheckTemp}°C reached target ${currentStep.target_temp}°C`)
            } else {
              actionTaken = 'profile_target_set'
              actionDetails = { profile_target: currentStep.target_temp, step_type: 'immediate_ramp' }
              console.log(`Immediate ramp: waiting for temp to reach ${currentStep.target_temp}°C (current: ${controller?.current_temp}°C)`)
            }
          } else {
            // Linear ramp
            if (controller && currentStep.duration_hours) {
              let startTemp: number = session.step_start_temp ?? controller.target_temp ?? currentStep.target_temp
              
              if (session.step_start_temp === null) {
                await supabase
                  .from('fermentation_sessions')
                  .update({ step_start_temp: startTemp })
                  .eq('id', session.id)
                console.log(`Saved start temp ${startTemp}°C for ramp`)
              }
              
              const timeComplete = elapsedHours >= currentStep.duration_hours
              const rampingUp = currentStep.target_temp > startTemp
              const rampCheckTemp = rampingUp
                ? (controller.pill_temp ?? controller.current_temp)
                : (controller.current_temp ?? controller.pill_temp)
              const tempReached = rampCheckTemp !== null && 
                Math.abs(rampCheckTemp - currentStep.target_temp) <= 0.3
              
              console.log(`Ramp: ${startTemp}°C → ${currentStep.target_temp}°C over ${currentStep.duration_hours}h, elapsed: ${elapsedHours.toFixed(2)}h, rampingUp: ${rampingUp}, sensor: ${rampingUp ? 'pill' : 'probe'}, sensorTemp: ${rampCheckTemp}°C, tempReached: ${tempReached}`)
              
              if (tempReached) {
                // Temperature has reached the final target — set profile target to final
                await setProfileTarget(supabase, session.controller_id, currentStep.target_temp)
                actionTaken = 'temp_reached'
                actionDetails = { target_temp: currentStep.target_temp, current_temp: rampCheckTemp }
                
                if (timeComplete) {
                  stepCompleted = true
                  actionDetails = { 
                    ...actionDetails, 
                    time_complete: true, 
                    temp_reached: true,
                  }
                  console.log(`Ramp complete: time elapsed and temp reached ${currentStep.target_temp}°C`)
                }
              } else {
                // Still ramping — calculate intermediate target and set as profile target
                const newTarget = calculateRampTemp(startTemp, currentStep.target_temp, currentStep.duration_hours, elapsedHours)
                const roundedTarget = Math.round(newTarget * 10) / 10
                
                // Only update if meaningful change
                const currentProfileTarget = controller.profile_target_temp ? parseFloat(String(controller.profile_target_temp)) : null
                if (currentProfileTarget === null || Math.abs(currentProfileTarget - roundedTarget) > 0.05) {
                  await setProfileTarget(supabase, session.controller_id, roundedTarget)
                  actionTaken = 'profile_target_set'
                  actionDetails = {
                    start_temp: startTemp,
                    intermediate_target: roundedTarget,
                    final_temp: currentStep.target_temp,
                    progress: Math.min(1, elapsedHours / currentStep.duration_hours),
                  }
                  
                  // Log ramp progress to adjustment history
                  await supabase
                    .from('auto_cooling_adjustments')
                    .insert({
                      cooler_controller_id: session.controller_id,
                      cooler_controller_name: controller.name || session.controller_id,
                      old_target_temp: currentProfileTarget ?? startTemp,
                      new_target_temp: roundedTarget,
                      original_target_temp: currentStep.target_temp,
                      lowest_followed_temp: roundedTarget,
                      followed_current_temp: controller.pill_temp ?? controller.current_temp,
                      followed_target_temp: controller.current_temp,
                      reason: `📈 Ramp ${startTemp.toFixed(1)}→${currentStep.target_temp}°C: mellenmål=${roundedTarget.toFixed(1)}°C (${Math.round(Math.min(1, elapsedHours / currentStep.duration_hours) * 100)}%)`,
                      adjusted_against_timestamp: controller.last_update,
                    })
                }
                
                if (timeComplete) {
                  console.log(`Ramp time complete but temp not reached: sensor=${rampCheckTemp}°C, target=${currentStep.target_temp}°C - waiting`)
                }
              }
            }
          }
          break
        }

        case 'wait_for_temp': {
          if (currentStep.target_temp !== null && controller) {
            // Set profile target — PID will handle the actual controller
            await setProfileTarget(supabase, session.controller_id, currentStep.target_temp)

            const waitCheckTemp = controller.pill_temp ?? controller.current_temp ?? null
            if (waitCheckTemp !== null && Math.abs(waitCheckTemp - currentStep.target_temp) <= 0.3) {
              stepCompleted = true
              actionTaken = 'temp_reached'
              actionDetails = { current_temp: waitCheckTemp, target_temp: currentStep.target_temp }
            } else {
              actionTaken = 'profile_target_set'
              actionDetails = { profile_target: currentStep.target_temp, step_type: 'wait_for_temp' }
            }
          }
          break
        }

        case 'wait_for_gravity_stable': {
          // Enforce effective target from previous steps
          const effectiveTarget = getEffectiveTargetTemp(steps as ProfileStep[], session.current_step_index)
          if (effectiveTarget !== null) {
            await setProfileTarget(supabase, session.controller_id, effectiveTarget)
          }
          
          if (brewData && currentStep.gravity_stable_days && currentStep.gravity_threshold) {
            const metrics = session.brew_id ? batchMetricsMap.get(session.brew_id) : null
            const stable = isGravityStable(
              brewData.sg_data,
              currentStep.gravity_stable_days,
              currentStep.gravity_threshold
            )
            const activityConfirms = !metrics || metrics.activity_score < 25
            if (stable && activityConfirms) {
              stepCompleted = true
              actionTaken = 'condition_met'
              actionDetails = { condition: 'gravity_stable', days: currentStep.gravity_stable_days, activity_score: metrics?.activity_score ?? null, fermentation_phase: metrics?.fermentation_phase ?? 'unknown' }
              console.log(`✅ Gravity stable: ${currentStep.gravity_stable_days}d, activity=${metrics?.activity_score ?? '?'}%, phase=${metrics?.fermentation_phase ?? '?'}`)
            } else if (stable && !activityConfirms) {
              console.log(`⚠️ Gravity stable but activity still ${metrics?.activity_score}% - waiting for confirmation`)
              actionDetails = { condition: 'gravity_stable_waiting_activity', activity_score: metrics?.activity_score, phase: metrics?.fermentation_phase }
            }
          }
          break
        }

        case 'wait_for_sg': {
          // Enforce effective target from previous steps
          const effectiveTarget = getEffectiveTargetTemp(steps as ProfileStep[], session.current_step_index)
          if (effectiveTarget !== null) {
            await setProfileTarget(supabase, session.controller_id, effectiveTarget)
          }
          
          if (brewData && currentStep.target_sg !== null && currentStep.sg_comparison) {
            const met = isSgConditionMet(brewData.sg_data, currentStep.target_sg, currentStep.sg_comparison)
            if (met) {
              stepCompleted = true
              actionTaken = 'condition_met'
              const sortedData = [...brewData.sg_data].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
              actionDetails = { 
                condition: 'sg_reached', 
                target_sg: currentStep.target_sg, 
                current_sg: sortedData[0]?.value,
                comparison: currentStep.sg_comparison 
              }
            }
          }
          break
        }

        case 'wait_for_acknowledgement': {
          // Enforce effective target from previous steps
          const effectiveTarget = getEffectiveTargetTemp(steps as ProfileStep[], session.current_step_index)
          if (effectiveTarget !== null) {
            await setProfileTarget(supabase, session.controller_id, effectiveTarget)
          }
          actionTaken = 'checked'
          break
        }

        case 'diacetyl_rest': {
          const attenuationTrigger = (currentStep as any).attenuation_trigger ?? 75
          const tempIncrease = (currentStep as any).temp_increase ?? 3
          const metrics = session.brew_id ? batchMetricsMap.get(session.brew_id) : null

          if (brewData) {
            const sortedSgData = [...brewData.sg_data].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            const latestSg = sortedSgData[0]?.value
            const og = brewData.original_gravity
            const fg = brewData.final_gravity
            const attRange = og - fg
            const currentAtt = attRange > 0 ? ((og - latestSg) / attRange) * 100 : 0

            const phaseReady = !metrics || metrics.fermentation_phase === 'declining' || metrics.fermentation_phase === 'stationary'
            const attenuationReady = currentAtt >= attenuationTrigger

            if (!attenuationReady || !phaseReady) {
              // Keep current temperature during wait
              const effectiveTarget = getEffectiveTargetTemp(steps as ProfileStep[], session.current_step_index)
              if (effectiveTarget !== null) {
                await setProfileTarget(supabase, session.controller_id, effectiveTarget)
              }
              const waitReason = !attenuationReady
                ? `attenuation ${Math.round(currentAtt)}% < ${attenuationTrigger}%`
                : `phase=${metrics?.fermentation_phase ?? 'unknown'} (need declining/stationary)`
              actionDetails = {
                phase: 'waiting_for_trigger',
                current_attenuation: Math.round(currentAtt),
                trigger: attenuationTrigger,
                fermentation_phase: metrics?.fermentation_phase ?? 'unknown',
                activity_score: metrics?.activity_score ?? null,
                wait_reason: waitReason,
              }
              console.log(`Diacetyl rest: waiting - ${waitReason}`)
              break
            }

            // Attenuation + phase ready — raise temp
            console.log(`🍺 Diacetyl rest triggered: att=${Math.round(currentAtt)}%, phase=${metrics?.fermentation_phase ?? 'unknown'}, activity=${metrics?.activity_score ?? '?'}%`)
            const effectiveTarget = getEffectiveTargetTemp(steps as ProfileStep[], session.current_step_index)
            const diacetylTarget = (effectiveTarget ?? 18) + tempIncrease

            // Set profile target — PID will handle actual controller
            await setProfileTarget(supabase, session.controller_id, diacetylTarget)
            actionTaken = 'profile_target_set'
            actionDetails = { profile_target: diacetylTarget, phase: 'diacetyl_active', temp_increase: tempIncrease, fermentation_phase: metrics?.fermentation_phase ?? 'unknown' }

            // Check if SG is now stable AND activity is low
            const stableDays = currentStep.gravity_stable_days ?? 2
            const threshold = currentStep.gravity_threshold ?? 0.001
            const sgStable = isGravityStable(brewData.sg_data, stableDays, threshold)
            const activityLow = !metrics || metrics.activity_score < 20

            if (sgStable && activityLow) {
              stepCompleted = true
              actionTaken = 'condition_met'
              actionDetails = { ...actionDetails, condition: 'diacetyl_rest_complete', stable_days: stableDays, activity_score: metrics?.activity_score ?? null }
              console.log(`✅ Diacetyl rest complete: SG stable ${stableDays}d, activity=${metrics?.activity_score ?? '?'}%`)
            } else if (sgStable && !activityLow) {
              console.log(`Diacetyl rest: SG stable but activity still high (${metrics?.activity_score}%) - waiting`)
              actionDetails = { ...actionDetails, phase: 'diacetyl_active_waiting', sg_stable: true, activity_score: metrics?.activity_score }
            }
          }
          break
        }

        case 'gradual_ramp': {
          const attenuationTrigger = (currentStep as any).attenuation_trigger ?? 75
          const tempIncrease = (currentStep as any).temp_increase ?? 3
          const metrics = session.brew_id ? batchMetricsMap.get(session.brew_id) : null

          if (brewData) {
            const sortedSgData = [...brewData.sg_data].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            const latestSg = sortedSgData[0]?.value
            const og = brewData.original_gravity
            const fg = brewData.final_gravity
            const attRange = og - fg
            const currentAtt = attRange > 0 ? ((og - latestSg) / attRange) * 100 : 0

            const phaseReady = !metrics || metrics.fermentation_phase === 'declining' || metrics.fermentation_phase === 'stationary'
            const attenuationReady = currentAtt >= attenuationTrigger

            if (!attenuationReady || !phaseReady) {
              // Phase 1: waiting for trigger — keep current temperature
              const effectiveTarget = getEffectiveTargetTemp(steps as ProfileStep[], session.current_step_index)
              if (effectiveTarget !== null) {
                await setProfileTarget(supabase, session.controller_id, effectiveTarget)
              }
              const waitReason = !attenuationReady
                ? `attenuation ${Math.round(currentAtt)}% < ${attenuationTrigger}%`
                : `phase=${metrics?.fermentation_phase ?? 'unknown'} (need declining/stationary)`
              actionDetails = {
                phase: 'waiting_for_trigger',
                current_attenuation: Math.round(currentAtt),
                trigger: attenuationTrigger,
                fermentation_phase: metrics?.fermentation_phase ?? 'unknown',
                activity_score: metrics?.activity_score ?? null,
                wait_reason: waitReason,
              }
              console.log(`Gradual ramp: waiting - ${waitReason}`)
              break
            }

            // Phase 2: Ramping — calculate target based on activity score
            const activityScore = metrics?.activity_score ?? 50
            const clampedActivity = Math.max(0, Math.min(100, activityScore))
            const effectiveTarget = getEffectiveTargetTemp(steps as ProfileStep[], session.current_step_index)
            const baseTemp = effectiveTarget ?? 18
            const rampedTarget = Math.round((baseTemp + tempIncrease * (1 - clampedActivity / 100)) * 10) / 10

            const currentProfileTarget = controller?.profile_target_temp ? parseFloat(String(controller.profile_target_temp)) : null
            if (currentProfileTarget === null || Math.abs(currentProfileTarget - rampedTarget) > 0.05) {
              await setProfileTarget(supabase, session.controller_id, rampedTarget)
              actionTaken = 'temp_adjusted'
              actionDetails = {
                phase: 'gradual_ramping',
                base_temp: baseTemp,
                ramped_target: rampedTarget,
                max_target: baseTemp + tempIncrease,
                activity_score: activityScore,
                ramp_progress: Math.round((1 - clampedActivity / 100) * 100),
                fermentation_phase: metrics?.fermentation_phase ?? 'unknown',
              }
              console.log(`🔄 Gradual ramp: activity=${activityScore}%, target=${rampedTarget}°C (base=${baseTemp}, +${tempIncrease}°C max)`)
            }

            // Phase 3: Check completion — SG stable + activity < 15
            const stableDays = currentStep.gravity_stable_days ?? 2
            const threshold = currentStep.gravity_threshold ?? 0.001
            const sgStable = isGravityStable(brewData.sg_data, stableDays, threshold)
            const activityLow = !metrics || metrics.activity_score < 15

            if (sgStable && activityLow) {
              stepCompleted = true
              actionTaken = 'condition_met'
              actionDetails = {
                condition: 'gradual_ramp_complete',
                stable_days: stableDays,
                activity_score: metrics?.activity_score ?? null,
                final_target: rampedTarget,
              }
              console.log(`✅ Gradual ramp complete: SG stable ${stableDays}d, activity=${metrics?.activity_score ?? '?'}%`)
            } else if (sgStable && !activityLow) {
              console.log(`Gradual ramp: SG stable but activity still ${metrics?.activity_score}% (need <15) - continuing`)
              actionDetails = { ...actionDetails, phase: 'gradual_ramping_waiting', sg_stable: true, activity_score: metrics?.activity_score }
            }
          }
          break
        }
      }

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
