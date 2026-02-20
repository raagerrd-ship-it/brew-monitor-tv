import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

interface ProfileStep {
  id: string
  profile_id: string
  step_order: number
  step_type: 'ramp' | 'hold' | 'wait_for_gravity_stable' | 'wait_for_sg' | 'wait_for_temp' | 'wait_for_acknowledgement'
  target_temp: number | null
  duration_hours: number | null
  ramp_type: 'linear' | 'immediate' | null
  gravity_stable_days: number | null
  gravity_threshold: number | null
  target_sg: number | null
  sg_comparison: 'at_or_below' | 'at_or_above' | null
  notes: string | null
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
// Stability means SG hasn't been more than threshold ABOVE current SG
// (During fermentation SG drops, so we check when it was last higher than current + threshold)
function isGravityStable(sgData: SgDataPoint[], stableDays: number, threshold: number): boolean {
  if (!sgData || sgData.length < 2) return false
  
  // Sort by date descending (newest first)
  const sortedData = [...sgData].sort((a, b) => 
    new Date(b.date).getTime() - new Date(a.date).getTime()
  )
  
  const currentSg = sortedData[0].value
  let stableFromDate = new Date(sortedData[0].date)
  
  // Walk backward to find when SG was last more than threshold ABOVE current
  for (let i = 1; i < sortedData.length; i++) {
    const reading = sortedData[i]
    // Check if reading was more than threshold above current SG
    if (reading.value > currentSg + threshold) {
      // This reading was too high, so stability started after this point
      break
    }
    // Reading is within threshold of current (not more than threshold higher), so stable since this point
    stableFromDate = new Date(reading.date)
  }
  
  // Calculate how long it's been stable
  const now = new Date()
  const stableHours = (now.getTime() - stableFromDate.getTime()) / (1000 * 60 * 60)
  const stableDaysActual = stableHours / 24
  
  console.log(`Gravity stability: current SG ${currentSg.toFixed(4)}, stable since ${stableFromDate.toISOString()}, ${stableDaysActual.toFixed(2)} days (need ${stableDays} days)`)
  
  return stableDaysActual >= stableDays
}

// Find the effective target temp by looking back through previous steps
function getEffectiveTargetTemp(steps: ProfileStep[], currentStepIndex: number): number | null {
  for (let i = currentStepIndex; i >= 0; i--) {
    if (steps[i].target_temp !== null) {
      return steps[i].target_temp
    }
  }
  return null
}

// Check if SG condition is met
function isSgConditionMet(sgData: SgDataPoint[], targetSg: number, comparison: string): boolean {
  if (!sgData || sgData.length === 0) return false
  
  // Get the latest reading
  const sortedData = [...sgData].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  const latestSg = sortedData[0].value
  
  if (comparison === 'at_or_below') {
    return latestSg <= targetSg
  } else if (comparison === 'at_or_above') {
    return latestSg >= targetSg
  }
  
  return false
}

// Calculate pill-compensated target temperature
// Targets the AVERAGE of pill (surface) and probe (core) to equal the profile goal.
// Formula: compensatedTarget = profileTarget - avgDelta/2
// This ensures (pill + ctrl) / 2 ≈ profileTarget
async function calculateCompensatedTarget(
  supabase: ReturnType<typeof createClient>,
  controllerId: string,
  profileTarget: number,
  currentControllerTarget: number,
  controllerName: string,
  _dampingFactor: number = 0.5,
  maxChangePerCycle: number = 0.3
): Promise<{ compensatedTarget: number; compensation: number; avgDelta: number } | null> {
  // Fetch last 3 delta measurements
  const { data: deltaHistory } = await supabase
    .from('temp_delta_history')
    .select('delta')
    .eq('controller_id', controllerId)
    .order('recorded_at', { ascending: false })
    .limit(3)

  if (!deltaHistory || deltaHistory.length === 0) {
    return null
  }

  const deltas = deltaHistory.map(d => parseFloat(String(d.delta)))
  const avgDelta = deltas.reduce((sum, d) => sum + d, 0) / deltas.length

  // Only compensate when pill is warmer than probe (positive delta)
  if (avgDelta <= 0) {
    return null
  }

  const MAX_CHANGE_PER_CYCLE = maxChangePerCycle
  const MAX_COMPENSATION = 5.0

  // Target average: compensate by half the delta so (pill+ctrl)/2 = profileTarget
  const compensation = avgDelta / 2
  let compensatedTarget = profileTarget - compensation

  // Safety floor: never more than 5°C below profile target
  compensatedTarget = Math.max(profileTarget - MAX_COMPENSATION, compensatedTarget)

  // Rate limit: scale with distance from target for faster recovery from spikes
  // When very far (>3°C), skip rate limit entirely to fix dangerous deviations immediately
  const diff = compensatedTarget - currentControllerTarget
  const distanceFromIdeal = Math.abs(diff)
  if (distanceFromIdeal > 3.0) {
    // Emergency: large deviation, set directly without rate limiting
    console.log(`⚠️ Pill-komp ${controllerName}: stor avvikelse ${distanceFromIdeal.toFixed(1)}°C, sätter direkt utan rate-limit`)
  } else if (distanceFromIdeal > 2.0) {
    const limit = MAX_CHANGE_PER_CYCLE * 3
    if (distanceFromIdeal > limit) {
      compensatedTarget = currentControllerTarget + (diff > 0 ? limit : -limit)
    }
  } else if (distanceFromIdeal > 1.0) {
    const limit = MAX_CHANGE_PER_CYCLE * 2
    if (distanceFromIdeal > limit) {
      compensatedTarget = currentControllerTarget + (diff > 0 ? limit : -limit)
    }
  } else if (distanceFromIdeal > MAX_CHANGE_PER_CYCLE) {
    compensatedTarget = currentControllerTarget + (diff > 0 ? MAX_CHANGE_PER_CYCLE : -MAX_CHANGE_PER_CYCLE)
  }

  // Round to 1 decimal
  compensatedTarget = Math.round(compensatedTarget * 10) / 10

  // Skip if change is negligible (< 0.1°C)
  if (Math.abs(compensatedTarget - currentControllerTarget) < 0.1) {
    console.log(`🎯 Pill-kompensation för ${controllerName}: redan nära mål (${currentControllerTarget}°C ≈ ${compensatedTarget}°C), skippar`)
    return null
  }

  console.log(`🎯 Pill-kompensation för ${controllerName}: profil=${profileTarget}°C, avgDelta=${avgDelta.toFixed(2)}°C, komp=delta/2=${compensation.toFixed(2)}°C, ny target=${compensatedTarget}°C (nuvarande=${currentControllerTarget}°C)`)

  return { compensatedTarget, compensation, avgDelta }
}

// Calculate the target temperature for a linear ramp
function calculateRampTemp(startTemp: number, endTemp: number, durationHours: number, elapsedHours: number): number {
  if (elapsedHours >= durationHours) return endTemp
  
  const progress = elapsedHours / durationHours
  return startTemp + (endTemp - startTemp) * progress
}

// Set target temperature via RAPT API
async function setControllerTargetTemp(controllerId: string, targetTemp: number): Promise<boolean> {
  const RAPT_API_SECRET = Deno.env.get('RAPT_API_SECRET')
  const RAPT_USERNAME = Deno.env.get('RAPT_USERNAME')
  
  if (!RAPT_API_SECRET || !RAPT_USERNAME) {
    console.error('Missing RAPT credentials')
    return false
  }

  try {
    // Get auth token
    const formData = new URLSearchParams()
    formData.append('client_id', 'rapt-user')
    formData.append('grant_type', 'password')
    formData.append('username', RAPT_USERNAME)
    formData.append('password', RAPT_API_SECRET)

    const authResponse = await fetch('https://id.rapt.io/connect/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    })

    if (!authResponse.ok) {
      console.error('RAPT auth failed:', authResponse.status, await authResponse.text())
      return false
    }

    const authData = await authResponse.json()
    const accessToken = authData.access_token

    // Set target temperature using correct API endpoint
    const queryParams = new URLSearchParams()
    queryParams.append('temperatureControllerId', controllerId)
    queryParams.append('target', targetTemp.toString())
    
    const apiUrl = `https://api.rapt.io/api/TemperatureControllers/SetTargetTemperature?${queryParams.toString()}`
    console.log('Setting temperature via:', apiUrl)
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      console.error('Failed to set temperature:', response.status, await response.text())
      return false
    }

    const result = await response.json()
    console.log('Temperature set successfully, result:', result)
    return result === true
  } catch (error) {
    console.error('Error setting temperature:', error)
    return false
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Load pill compensation settings
    const { data: acSettings } = await supabase
      .from('auto_cooling_settings')
      .select('pill_compensation_enabled, pill_compensation_damping, pill_compensation_rate_limit')
      .limit(1)
      .maybeSingle()

    const pillCompEnabled = (acSettings as any)?.pill_compensation_enabled ?? true
    const pillCompDamping = parseFloat(String((acSettings as any)?.pill_compensation_damping ?? 0.4))
    const pillCompRateLimit = parseFloat(String((acSettings as any)?.pill_compensation_rate_limit ?? 0.3))

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

    for (const session of sessions as Session[]) {
      // Get profile steps
      const { data: steps, error: stepsError } = await supabase
        .from('fermentation_profile_steps')
        .select('*')
        .eq('profile_id', session.profile_id)
        .order('step_order', { ascending: true })

      if (stepsError || !steps || steps.length === 0) {
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

        results.push({ sessionId: session.id, action: 'completed', details: {} })
        continue
      }

      // Get controller data
      const { data: controller } = await supabase
        .from('rapt_temp_controllers')
        .select('*')
        .eq('controller_id', session.controller_id)
        .single()

      // Get brew data if linked
      let brewData: { sg_data: SgDataPoint[] } | null = null
      if (session.brew_id) {
        const { data } = await supabase
          .from('brew_readings')
          .select('sg_data')
          .eq('id', session.brew_id)
          .single()
        brewData = data as { sg_data: SgDataPoint[] } | null
      }

      const stepStartedAt = new Date(session.step_started_at)
      const now = new Date()
      const elapsedHours = (now.getTime() - stepStartedAt.getTime()) / (1000 * 60 * 60)

      let stepCompleted = false
      let actionTaken = 'checked'
      let actionDetails: any = {}

      // For steps without explicit target_temp, enforce the effective target from previous steps
      // BUT respect recent overshoot adjustments — let overshoot prevention do its job
      if (currentStep.target_temp === null && controller) {
        const effectiveTarget = getEffectiveTargetTemp(steps as ProfileStep[], session.current_step_index)
        if (effectiveTarget !== null) {
          // Calculate pill-compensated target
          const compensation = pillCompEnabled ? await calculateCompensatedTarget(
            supabase, session.controller_id, effectiveTarget, controller.target_temp, controller.name || session.controller_id, pillCompDamping, pillCompRateLimit
          ) : null

          // If pill-comp is enabled but returned null, the target is already correctly compensated — skip enforce
          if (pillCompEnabled && !compensation) {
            console.log(`Step ${session.current_step_index} (${currentStep.step_type}): pill-komp aktiv men redan nära mål (${controller.target_temp}°C), skippar enforce`)
          } else {
          const targetToEnforce = compensation ? compensation.compensatedTarget : effectiveTarget

          if (controller.target_temp < targetToEnforce - 0.2) {
            // Controller target is LOWER than desired — check if overshoot caused it
            const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString()
            const { data: recentOvershoot } = await supabase
              .from('auto_cooling_adjustments')
              .select('id, reason, new_target_temp, created_at')
              .eq('cooler_controller_id', session.controller_id)
              .gte('created_at', fifteenMinAgo)
              .or('reason.like.🌡️%,reason.like.🔄%')
              .order('created_at', { ascending: false })
              .limit(1)

            if (recentOvershoot && recentOvershoot.length > 0) {
              console.log(`Step ${session.current_step_index} (${currentStep.step_type}): Overshoot aktiv (${recentOvershoot[0].reason.substring(0, 50)}), låter den verka istället för att enforce:a ${targetToEnforce}°C`)
            } else {
              console.log(`Step ${session.current_step_index} (${currentStep.step_type}) enforcing target ${targetToEnforce}°C (profile=${effectiveTarget}°C, current=${controller.target_temp}°C${compensation ? `, komp=${compensation.compensation.toFixed(2)}°C` : ''})`)
              const success = await setControllerTargetTemp(session.controller_id, targetToEnforce)
              if (success) {
                actionTaken = 'temp_enforced'
                actionDetails = { effective_target: targetToEnforce, profile_target: effectiveTarget, previous_target: controller.target_temp, step_type: currentStep.step_type, pill_compensation: compensation?.compensation ?? 0 }
                
                await supabase
                  .from('rapt_temp_controllers')
                  .update({ target_temp: targetToEnforce, updated_at: new Date().toISOString() })
                  .eq('controller_id', session.controller_id)
                
                const reason = compensation
                  ? `🎯 Pill-kompensation: ${effectiveTarget.toFixed(1)}°C -> ${targetToEnforce.toFixed(1)}°C (delta=${compensation.avgDelta.toFixed(2)}, komp=${compensation.compensation.toFixed(2)}°C)`
                  : `🔧 Fermenteringsprofil enforce: ${effectiveTarget}°C`
                
                await supabase
                  .from('auto_cooling_adjustments')
                  .insert({
                    cooler_controller_id: session.controller_id,
                    cooler_controller_name: controller.name || session.controller_id,
                    old_target_temp: controller.target_temp,
                    new_target_temp: targetToEnforce,
                    original_target_temp: effectiveTarget,
                    lowest_followed_temp: effectiveTarget,
                    followed_current_temp: controller.pill_temp,
                    followed_target_temp: controller.current_temp,
                    followed_hysteresis: compensation?.avgDelta ?? null,
                    reason,
                    adjusted_against_timestamp: controller.last_update,
                  })
              }
            }
          } else if (controller.target_temp > targetToEnforce + 0.2) {
            // Controller target is HIGHER than desired — always enforce down
            console.log(`Step ${session.current_step_index} (${currentStep.step_type}): target ${controller.target_temp}°C > desired ${targetToEnforce}°C, enforcing down`)
            const success = await setControllerTargetTemp(session.controller_id, targetToEnforce)
            if (success) {
              actionTaken = 'temp_enforced'
              actionDetails = { effective_target: targetToEnforce, profile_target: effectiveTarget, previous_target: controller.target_temp, step_type: currentStep.step_type, pill_compensation: compensation?.compensation ?? 0 }
              
              await supabase
                .from('rapt_temp_controllers')
                .update({ target_temp: targetToEnforce, updated_at: new Date().toISOString() })
                .eq('controller_id', session.controller_id)
              
              const reason = compensation
                ? `🎯 Pill-kompensation: ${effectiveTarget.toFixed(1)}°C -> ${targetToEnforce.toFixed(1)}°C (delta=${compensation.avgDelta.toFixed(2)}, komp=${compensation.compensation.toFixed(2)}°C)`
                : `🔧 Fermenteringsprofil enforce: ${effectiveTarget}°C`
              
              await supabase
                .from('auto_cooling_adjustments')
                .insert({
                  cooler_controller_id: session.controller_id,
                  cooler_controller_name: controller.name || session.controller_id,
                  old_target_temp: controller.target_temp,
                  new_target_temp: targetToEnforce,
                  original_target_temp: effectiveTarget,
                  lowest_followed_temp: effectiveTarget,
                  followed_current_temp: controller.pill_temp,
                  followed_target_temp: controller.current_temp,
                  followed_hysteresis: compensation?.avgDelta ?? null,
                  reason,
                  adjusted_against_timestamp: controller.last_update,
                })
            }
          }
          } // end else (pill-comp not skipping)
        }
      }

      switch (currentStep.step_type) {
        case 'hold': {
          // Hold temperature for duration or until SG target is met
          if (currentStep.target_temp !== null && controller) {
            // Calculate pill-compensated target for hold steps
            const holdCompensation = pillCompEnabled ? await calculateCompensatedTarget(
              supabase, session.controller_id, currentStep.target_temp, controller.target_temp, controller.name || session.controller_id, pillCompDamping, pillCompRateLimit
            ) : null
            const holdTarget = holdCompensation ? holdCompensation.compensatedTarget : currentStep.target_temp

            // Check if we need to adjust temperature
            if (Math.abs(controller.target_temp - holdTarget) > 0.1) {
              const success = await setControllerTargetTemp(session.controller_id, holdTarget)
              if (success) {
                actionTaken = 'temp_adjusted'
                actionDetails = { target_temp: holdTarget, profile_target: currentStep.target_temp, pill_compensation: holdCompensation?.compensation ?? 0 }
                
                // Update controller in database
                await supabase
                  .from('rapt_temp_controllers')
                  .update({ target_temp: holdTarget, updated_at: new Date().toISOString() })
                  .eq('controller_id', session.controller_id)

                // Log pill-compensation adjustment
                if (holdCompensation) {
                  await supabase
                    .from('auto_cooling_adjustments')
                    .insert({
                      cooler_controller_id: session.controller_id,
                      cooler_controller_name: controller.name || session.controller_id,
                      old_target_temp: controller.target_temp,
                      new_target_temp: holdTarget,
                      original_target_temp: currentStep.target_temp,
                      lowest_followed_temp: currentStep.target_temp,
                      followed_current_temp: controller.pill_temp,
                      followed_target_temp: controller.current_temp,
                      followed_hysteresis: holdCompensation.avgDelta,
                      reason: `🎯 Pill-kompensation: ${currentStep.target_temp.toFixed(1)}°C -> ${holdTarget.toFixed(1)}°C (delta=${holdCompensation.avgDelta.toFixed(2)}, komp=${holdCompensation.compensation.toFixed(2)}°C)`,
                      adjusted_against_timestamp: controller.last_update,
                    })
                }
              }
            }
          }
          
          // Check completion conditions - either duration OR SG target
          let durationComplete = false
          let sgTargetMet = false
          
          // Check if duration has passed (if set)
          if (currentStep.duration_hours && elapsedHours >= currentStep.duration_hours) {
            durationComplete = true
          }
          
          // Check if SG target is met (if set)
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
          
          // Verify temp is at target before allowing completion (within 0.3°C)
          const holdEffectiveTarget = currentStep.target_temp ?? getEffectiveTargetTemp(steps as ProfileStep[], session.current_step_index)
          const holdTempOk = !holdEffectiveTarget || !controller || 
            (controller.current_temp !== null && Math.abs(controller.current_temp - holdEffectiveTarget) <= 0.3)
          
          if (!holdTempOk) {
            console.log(`Hold step: condition met but temp not at target (current ${controller?.current_temp}°C, target ${holdEffectiveTarget}°C) - waiting`)
          }
          
          // Complete if EITHER condition is met AND temp is at target
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
            // Set temperature immediately
            if (controller && Math.abs(controller.target_temp - currentStep.target_temp) > 0.1) {
              const success = await setControllerTargetTemp(session.controller_id, currentStep.target_temp)
              if (success) {
                actionTaken = 'temp_adjusted'
                actionDetails = { target_temp: currentStep.target_temp }
                
                await supabase
                  .from('rapt_temp_controllers')
                  .update({ target_temp: currentStep.target_temp, updated_at: new Date().toISOString() })
                  .eq('controller_id', session.controller_id)
              }
            }
            // Don't mark complete until temperature is actually reached
            if (controller && controller.current_temp !== null &&
                Math.abs(controller.current_temp - currentStep.target_temp) <= 0.3) {
              stepCompleted = true
              console.log(`Immediate ramp complete: temp ${controller.current_temp}°C reached target ${currentStep.target_temp}°C`)
            } else {
              console.log(`Immediate ramp: waiting for temp to reach ${currentStep.target_temp}°C (current: ${controller?.current_temp}°C)`)
            }
          } else {
            // Linear ramp - use saved start temp or save it now
            if (controller && currentStep.duration_hours) {
              let startTemp: number = session.step_start_temp ?? controller.target_temp ?? currentStep.target_temp
              
              // If no start temp saved yet, save the current controller target temp
              if (session.step_start_temp === null) {
                await supabase
                  .from('fermentation_sessions')
                  .update({ step_start_temp: startTemp })
                  .eq('id', session.id)
                console.log(`Saved start temp ${startTemp}°C for ramp`)
              }
              
              const newTarget = calculateRampTemp(startTemp, currentStep.target_temp, currentStep.duration_hours, elapsedHours)
              
              console.log(`Ramp: ${startTemp}°C → ${currentStep.target_temp}°C over ${currentStep.duration_hours}h, elapsed: ${elapsedHours.toFixed(2)}h, newTarget: ${newTarget.toFixed(1)}°C, current: ${controller.target_temp}°C`)
              
              if (Math.abs(controller.target_temp - newTarget) > 0.1) {
                const success = await setControllerTargetTemp(session.controller_id, Math.round(newTarget * 10) / 10)
                if (success) {
                  actionTaken = 'temp_adjusted'
                  actionDetails = { start_temp: startTemp, target_temp: newTarget, final_temp: currentStep.target_temp, progress: elapsedHours / currentStep.duration_hours }
                  
                  await supabase
                    .from('rapt_temp_controllers')
                    .update({ target_temp: newTarget, updated_at: new Date().toISOString() })
                    .eq('controller_id', session.controller_id)
                }
              }
              
              // Check if BOTH time has passed AND target temperature is reached (within 0.3°C)
              const timeComplete = elapsedHours >= currentStep.duration_hours
              const tempReached = controller.current_temp !== null && 
                Math.abs(controller.current_temp - currentStep.target_temp) <= 0.3
              
              if (timeComplete && tempReached) {
                stepCompleted = true
                actionDetails = { 
                  ...actionDetails, 
                  time_complete: true, 
                  temp_reached: true,
                  current_temp: controller.current_temp,
                  target_temp: currentStep.target_temp
                }
                console.log(`Ramp complete: time elapsed and temp ${controller.current_temp}°C reached target ${currentStep.target_temp}°C`)
              } else if (timeComplete && !tempReached) {
                console.log(`Ramp time complete but temp not reached: current ${controller.current_temp}°C, target ${currentStep.target_temp}°C (need within 0.3°C) - waiting for temp`)
              }
            }
          }
          break
        }

        case 'wait_for_temp': {
          if (currentStep.target_temp !== null && controller) {
            // Check if current temp has reached target
            if (Math.abs(controller.current_temp - currentStep.target_temp) <= 0.5) {
              stepCompleted = true
              actionDetails = { current_temp: controller.current_temp, target_temp: currentStep.target_temp }
            }
          }
          break
        }

        case 'wait_for_gravity_stable': {
          if (brewData && currentStep.gravity_stable_days && currentStep.gravity_threshold) {
            const stable = isGravityStable(
              brewData.sg_data,
              currentStep.gravity_stable_days,
              currentStep.gravity_threshold
            )
            if (stable) {
              stepCompleted = true
              actionTaken = 'condition_met'
              actionDetails = { condition: 'gravity_stable', days: currentStep.gravity_stable_days }
            }
          }
          break
        }

        case 'wait_for_sg': {
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
          // This step never auto-completes - it requires manual acknowledgement from the user
          // The edge function just skips it; the UI handles the acknowledge action
          actionTaken = 'checked'
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
          // Profile completed
          await supabase
            .from('fermentation_sessions')
            .update({ status: 'completed', completed_at: new Date().toISOString() })
            .eq('id', session.id)

          await supabase.from('fermentation_step_log').insert({
            session_id: session.id,
            step_index: nextStepIndex,
            action: 'completed',
            details: { message: 'Profile completed' },
          })

          results.push({ sessionId: session.id, action: 'profile_completed', details: {} })
        } else {
          // Move to next step - reset step_start_temp for new step
          await supabase
            .from('fermentation_sessions')
            .update({ 
              current_step_index: nextStepIndex, 
              step_started_at: new Date().toISOString(),
              step_start_temp: null  // Reset for new step
            })
            .eq('id', session.id)

          await supabase.from('fermentation_step_log').insert({
            session_id: session.id,
            step_index: nextStepIndex,
            action: 'started',
            details: { step_type: steps[nextStepIndex].step_type },
          })

          results.push({ sessionId: session.id, action: 'step_advanced', details: { newStepIndex: nextStepIndex } })
        }
      } else {
        results.push({ sessionId: session.id, action: actionTaken, details: actionDetails })
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    console.error('Error processing fermentation profiles:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
