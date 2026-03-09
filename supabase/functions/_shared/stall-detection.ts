import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { TempController, setControllerTargetTemp, RaptUpdateBatch } from './temp-utils.ts'
import { insertNotification } from './notifications.ts'
import { logAdjustment, AdjustmentResult } from './adjustment-logger.ts'

// ============================================================
// Stall Detection & Adaptive Boost (Feature 2)
// Single Source of Truth for stall logic — extracted from auto-adjust-cooling.
// ============================================================

export interface StallSettings {
  enabled: boolean
  sgRateThreshold: number
  minAttenuation: number
  maxAttenuation: number
}

export interface StallContext {
  supabase: ReturnType<typeof createClient>
  supabaseUrl: string
  serviceRoleKey: string
  followedControllersFullData: TempController[]
  profileOwnedControllerIds: Set<string>
  profileTargetMap: Map<string, number>
  sessionBrewIdMap: Map<string, string>
  log: (step: string, result: 'pass' | 'fail' | 'info' | 'action', message: string, details?: Record<string, unknown>) => void
  updateBatch?: RaptUpdateBatch
}

/** Evaluate pending boost outcomes and learn from them */
export async function evaluateBoostOutcomes(
  ctx: StallContext,
  stallSettings: StallSettings
): Promise<void> {
  const { supabase, log } = ctx

  const { data: pendingOutcomes } = await supabase
    .from('stall_boost_outcomes')
    .select('id, controller_id, brew_id, boost_degrees, sg_rate_before, created_at')
    .eq('outcome', 'pending')
    .lt('created_at', new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString())

  if (!pendingOutcomes || pendingOutcomes.length === 0) return

  for (const outcome of pendingOutcomes) {
    let sgRateAfter: number | null = null
    if (outcome.brew_id) {
      const { data: brew } = await supabase
        .from('brew_readings')
        .select('sg_data')
        .eq('id', outcome.brew_id)
        .maybeSingle()

      if (brew?.sg_data) {
        const sgData = (Array.isArray(brew.sg_data) ? brew.sg_data : []) as Array<{ date: string; value: number }>
        const sortedSg = [...sgData].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        const boostTime = new Date(outcome.created_at).getTime()
        const postBoostSg = sortedSg.filter(p => {
          const t = new Date(p.date).getTime()
          return t > boostTime + 6 * 60 * 60 * 1000 && t < boostTime + 24 * 60 * 60 * 1000
        })
        if (postBoostSg.length >= 2) {
          const newest = postBoostSg[0]
          const oldest = postBoostSg[postBoostSg.length - 1]
          const hours = (new Date(newest.date).getTime() - new Date(oldest.date).getTime()) / (1000 * 60 * 60)
          if (hours > 3) {
            sgRateAfter = ((oldest.value - newest.value) / hours) * 24
          }
        }
      }
    }

    const isEffective = sgRateAfter !== null && sgRateAfter > stallSettings.sgRateThreshold
    await supabase.from('stall_boost_outcomes').update({
      sg_rate_after: sgRateAfter,
      outcome: sgRateAfter !== null ? (isEffective ? 'effective' : 'ineffective') : 'no_data',
      evaluated_at: new Date().toISOString(),
    }).eq('id', outcome.id)

    if (sgRateAfter !== null) {
      const { data: learned } = await supabase
        .from('fermentation_learnings')
        .select('learned_value, sample_count')
        .eq('controller_id', outcome.controller_id)
        .eq('parameter_name', 'stall_boost_degrees')
        .maybeSingle()

      const currentLearned = learned?.learned_value ?? 1.0
      const sampleCount = learned?.sample_count ?? 0
      const boostUsed = parseFloat(String(outcome.boost_degrees))
      let newValue = currentLearned

      if (!isEffective) {
        newValue = Math.min(6.0, boostUsed * 2)
        log('STALL_LEARN', 'action', `Boost ${boostUsed.toFixed(1)}°C ineffektiv → dubblerar till ${newValue.toFixed(1)}°C`)
      } else if (sgRateAfter > stallSettings.sgRateThreshold * 3) {
        newValue = Math.max(0.5, boostUsed * 0.75)
        log('STALL_LEARN', 'info', `Boost ${boostUsed.toFixed(1)}°C väldigt effektiv → minskar till ${newValue.toFixed(1)}°C`)
      } else {
        const alpha = sampleCount < 3 ? 0.8 : 0.5
        newValue = currentLearned * (1 - alpha) + boostUsed * alpha
        log('STALL_LEARN', 'info', `Boost ${boostUsed.toFixed(1)}°C effektiv → låser in ${newValue.toFixed(1)}°C`)
      }

      newValue = Math.max(0.5, Math.min(6.0, Math.round(newValue * 10) / 10))

      await supabase.from('fermentation_learnings').upsert({
        controller_id: outcome.controller_id,
        parameter_name: 'stall_boost_degrees',
        learned_value: newValue,
        sample_count: sampleCount + 1,
        last_updated_at: new Date().toISOString(),
      }, { onConflict: 'controller_id,parameter_name' })

      log('STALL_LEARN', 'info', `Utvärderade boost-utfall för ${outcome.controller_id}`, {
        boost_degrees: boostUsed,
        sg_rate_before: outcome.sg_rate_before.toFixed(4),
        sg_rate_after: sgRateAfter.toFixed(4),
        outcome: isEffective ? 'effective' : 'ineffective',
        learned_boost: `${currentLearned.toFixed(1)} → ${newValue.toFixed(1)}°C`,
        samples: sampleCount + 1,
      })
    }
  }
}

/** Detect stalls and apply adaptive boost / un-boost */
export async function detectAndHandleStalls(
  ctx: StallContext,
  stallSettings: StallSettings
): Promise<AdjustmentResult[]> {
  const { supabase, supabaseUrl, serviceRoleKey, followedControllersFullData, profileOwnedControllerIds, profileTargetMap, sessionBrewIdMap, log } = ctx
  const adjustments: AdjustmentResult[] = []

  log('STALL', 'info', '--- Stall detection check ---')

  for (const cId of profileOwnedControllerIds) {
   try {
    const profileTarget = profileTargetMap.get(cId)
    const fc = followedControllersFullData.find(c => c.controller_id === cId)
    if (!fc) continue

    // Cold crash guard: never boost when profile target is below 10°C
    // (cold crash / conditioning steps should not trigger stall detection)
    if (profileTarget !== undefined && profileTarget < 10) {
      log('STALL_SKIP', 'info', `${fc.name}: Profilmål ${profileTarget}°C < 10°C — cold crash, hoppar över stall-detektion`)
      continue
    }

    // Get learned boost degrees
    const { data: learnedBoost } = await supabase
      .from('fermentation_learnings')
      .select('learned_value, sample_count')
      .eq('controller_id', fc.controller_id)
      .eq('parameter_name', 'stall_boost_degrees')
      .maybeSingle()

    const boostDeg = learnedBoost?.learned_value ?? 1.0
    const boostSamples = learnedBoost?.sample_count ?? 0

    // Find linked brew
    const sessionBrewId = sessionBrewIdMap.get(fc.controller_id)
    let brewLink: any = null
    if (sessionBrewId) {
      const { data } = await supabase.from('brew_readings')
        .select('id, name, sg_data, original_gravity, final_gravity, status')
        .eq('id', sessionBrewId).maybeSingle()
      brewLink = data
    }
    if (!brewLink) {
      const { data } = await supabase.from('brew_readings')
        .select('id, name, sg_data, original_gravity, final_gravity, status')
        .eq('linked_controller_id', fc.controller_id)
        .in('status', ['Fermenting', 'Jäsning'])
        .order('updated_at', { ascending: false }).limit(1).maybeSingle()
      brewLink = data
    }
    if (!brewLink) {
      log('STALL_SKIP', 'info', `${fc.name}: Ingen aktiv bryggning kopplad`)
      continue
    }

    const brewName = brewLink.name ?? brewLink.id
    const now = Date.now()

    // Fetch pre-computed metrics
    const { data: metrics } = await supabase
      .from('brew_fermentation_metrics')
      .select('activity_score, sg_rate_per_hour, fermentation_phase')
      .eq('brew_id', brewLink.id).maybeSingle()

    if (!metrics) {
      log('STALL_SKIP', 'info', `${fc.name} (${brewName}): Inga förberäknade metrics`)
      continue
    }

    const sgRatePerHour = parseFloat(String(metrics.sg_rate_per_hour))
    const sgRatePerDay = sgRatePerHour * 24
    const activityScore = parseFloat(String(metrics.activity_score))
    const phase = metrics.fermentation_phase

    const sgIsStalling = sgRatePerDay < stallSettings.sgRateThreshold
    const activityIsLow = activityScore < 20

    // Check attenuation range
    const og = parseFloat(String(brewLink.original_gravity ?? 0))
    const fg = parseFloat(String(brewLink.final_gravity ?? 0))
    const sgData = (Array.isArray(brewLink.sg_data) ? brewLink.sg_data : []) as Array<{ date: string; value: number }>
    const sortedSg = [...sgData].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    const currentSg = sortedSg.length > 0 ? sortedSg[0].value : og
    const attenuationRange = og - fg
    const currentAttenuation = attenuationRange > 0 ? ((og - currentSg) / attenuationRange) * 100 : 0

    if (currentAttenuation < stallSettings.minAttenuation || currentAttenuation > stallSettings.maxAttenuation) {
      log('STALL_SKIP', 'info', `${fc.name} (${brewName}): Utjäsning ${currentAttenuation.toFixed(0)}% utanför intervall ${stallSettings.minAttenuation}-${stallSettings.maxAttenuation}%`)
      continue
    }

    const stallDetected = sgIsStalling && activityIsLow

    // Check pill delta for stall context
    const pillTemp = fc.pill_temp !== null ? parseFloat(String(fc.pill_temp)) : null
    const ctrlTemp = fc.current_temp !== null ? parseFloat(String(fc.current_temp)) : null
    const currentAvgDelta = pillTemp !== null && ctrlTemp !== null ? Math.abs(pillTemp - ctrlTemp) : null
    const deltaIsLow = currentAvgDelta !== null && currentAvgDelta < 0.5

    const ratePct = stallSettings.sgRateThreshold > 0 ? ((sgRatePerDay / stallSettings.sgRateThreshold) * 100).toFixed(0) : '?'
    log('STALL_ANALYSIS', stallDetected ? 'action' : 'info', `${fc.name} (${brewName})`, {
      sg_rate: `${sgRatePerDay.toFixed(4)}/dag (${ratePct}% av tröskel)`,
      sg_stalling: sgIsStalling,
      activity_score: activityScore,
      activity_low: activityIsLow,
      phase,
      stall_detected: stallDetected,
      learned_boost: `${boostDeg.toFixed(1)}°C (${boostSamples} samples)`,
    })

    if (!stallDetected) {
      // UN-BOOST: If fermentation resumed, reverse active boost
      await handleUnBoost(ctx, fc, cId, profileTarget, boostDeg, activityScore, phase, now)
      continue
    }

    // Cooldown: don't boost within 6 hours
    const { data: lastBoost } = await supabase
      .from('auto_cooling_adjustments')
      .select('created_at')
      .eq('cooler_controller_id', fc.controller_id)
      .like('reason', '🔥%')
      .order('created_at', { ascending: false }).limit(1)

    if (lastBoost && lastBoost.length > 0) {
      const hoursSinceBoost = (now - new Date(lastBoost[0].created_at).getTime()) / (1000 * 60 * 60)
      if (hoursSinceBoost < 6) {
        log('STALL_COOLDOWN', 'info', `${fc.name}: Senaste boost var ${hoursSinceBoost.toFixed(1)}h sedan (väntar 6h)`)
        continue
      }
    }

    // Apply adaptive boost
    const currentTarget = parseFloat(String(fc.target_temp ?? 20))
    const effectiveProfileTarget = profileTarget ?? currentTarget
    const maxTemp = parseFloat(String(fc.max_target_temp ?? 25))
    const boostedTarget = currentTarget + boostDeg

    if (boostedTarget > maxTemp) {
      log('STALL_SKIP', 'info', `${fc.name}: Boost blocked by safety bounds (${boostedTarget.toFixed(1)}°C > max=${maxTemp}°C)`)
      continue
    }

    log('STALL_BOOST', 'action', `${fc.name}: Stall! Adaptiv boost +${boostDeg.toFixed(1)}°C (lärd från ${boostSamples} tidigare boosts)`)

    // Try PID-based boost first, fall back to direct
    const { data: existingComp } = await supabase
      .from('controller_learned_compensation')
      .select('id, learned_pi_correction, accumulated_integral')
      .eq('controller_id', fc.controller_id)
      .eq('delta_bucket', 'active')
      .eq('mode', fc.cooling_enabled ? 'cooling' : 'heating')
      .limit(1).maybeSingle()

    if (existingComp) {
      const newCorrection = existingComp.learned_pi_correction + boostDeg
      await supabase.from('controller_learned_compensation')
        .update({
          learned_pi_correction: newCorrection,
          accumulated_integral: existingComp.accumulated_integral + boostDeg,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingComp.id)
      log('STALL_BOOST', 'pass', `${fc.name}: PID +${boostDeg.toFixed(1)}°C (total: ${newCorrection.toFixed(2)}°C)`)
    } else {
      const safeTarget = Math.min(maxTemp, boostedTarget)
      let boostSuccess: boolean
      if (ctx.updateBatch) {
        ctx.updateBatch.add(fc.controller_id, safeTarget, parseFloat(String(fc.target_temp ?? '0')))
        boostSuccess = true
      } else {
        boostSuccess = await setControllerTargetTemp(supabaseUrl, serviceRoleKey, fc.controller_id, safeTarget)
      }
      if (boostSuccess) {
        if (!ctx.updateBatch) {
          await supabase.from('rapt_temp_controllers')
            .update({ target_temp: safeTarget, updated_at: new Date().toISOString() })
            .eq('controller_id', fc.controller_id)
        }
        log('STALL_BOOST', 'pass', `${fc.name}: Direkt boost ${currentTarget}°C → ${safeTarget}°C${ctx.updateBatch ? ' (batched)' : ''}`)
      } else {
        log('STALL_BOOST', 'fail', `${fc.name}: Kunde inte höja temperaturen`)
        continue
      }
    }

    adjustments.push({ cooler: fc.name, oldTarget: currentTarget, newTarget: boostedTarget })

    // Record outcome for learning
    await supabase.from('stall_boost_outcomes').insert({
      controller_id: fc.controller_id,
      brew_id: brewLink.id,
      boost_degrees: boostDeg,
      sg_rate_before: sgRatePerDay,
      outcome: 'pending',
    })

    await insertNotification(supabase, {
      type: 'stall_boost',
      title: 'Stall detekterad',
      body: `${fc.name} (${brewName}): +${boostDeg.toFixed(1)}°C boost, aktivitet ${activityScore}%, SG-rate ${sgRatePerDay.toFixed(4)}/dag`,
      brew_id: brewLink.id,
      controller_id: fc.controller_id,
    })

    await logAdjustment(supabase, {
      cooler_controller_id: fc.controller_id,
      cooler_controller_name: fc.name,
      old_target_temp: currentTarget,
      new_target_temp: Math.min(maxTemp, boostedTarget),
      original_target_temp: effectiveProfileTarget,
      lowest_followed_temp: currentTarget,
      followed_controller_id: fc.controller_id,
      followed_controller_name: fc.name,
      followed_current_temp: parseFloat(String(fc.pill_temp ?? fc.current_temp ?? 0)),
      followed_target_temp: effectiveProfileTarget,
      reason: `🔥 Stall: aktivitet ${activityScore}%, fas ${phase}, SG-rate ${sgRatePerDay.toFixed(4)}/dag, boost +${boostDeg.toFixed(1)}°C (lärd n=${boostSamples})`,
    })

    // Log in fermentation step log
    const { data: activeSession } = await supabase
      .from('fermentation_sessions')
      .select('id, current_step_index')
      .eq('controller_id', fc.controller_id)
      .eq('status', 'running')
      .limit(1).maybeSingle()

    if (activeSession) {
      await supabase.from('fermentation_step_log').insert({
        session_id: activeSession.id,
        step_index: activeSession.current_step_index,
        action: 'stall_boost',
        details: {
          boost_degrees: boostDeg,
          learned_samples: boostSamples,
          via: existingComp ? 'pid_compensation' : 'direct',
          sg_rate_per_day: sgRatePerDay,
          current_sg: currentSg,
          profile_target: effectiveProfileTarget,
          delta_current: currentAvgDelta,
          delta_is_low: deltaIsLow,
        },
      })
    }
   } catch (stallError) {
    const errorMsg = stallError instanceof Error ? stallError.message : String(stallError)
    log('STALL_ERROR', 'fail', `Stall-hantering kraschade för controller ${cId}: ${errorMsg}`)
   }
  }

  return adjustments
}

/** Handle un-boost when fermentation resumes after a stall */
async function handleUnBoost(
  ctx: StallContext,
  fc: TempController,
  controllerId: string,
  profileTarget: number | undefined,
  boostDeg: number,
  activityScore: number,
  phase: string,
  now: number
): Promise<void> {
  const { supabase, supabaseUrl, serviceRoleKey, log } = ctx

  const { data: recentBoost } = await supabase
    .from('auto_cooling_adjustments')
    .select('created_at, new_target_temp, old_target_temp, reason')
    .eq('cooler_controller_id', fc.controller_id)
    .like('reason', '🔥%')
    .order('created_at', { ascending: false }).limit(1)

  if (!recentBoost || recentBoost.length === 0) return

  const boostAgeHours = (now - new Date(recentBoost[0].created_at).getTime()) / (1000 * 60 * 60)
  const alreadyReversed = await supabase
    .from('auto_cooling_adjustments')
    .select('id')
    .eq('cooler_controller_id', fc.controller_id)
    .like('reason', '🔄%')
    .gt('created_at', recentBoost[0].created_at).limit(1)

  if (boostAgeHours >= 24 || (alreadyReversed.data && alreadyReversed.data.length > 0)) return

  const currentTarget = parseFloat(String(fc.target_temp ?? 20))
  const effectiveProfileTarget = profileTarget ?? currentTarget

  // Check if boost was applied via PID compensation
  const { data: existingComp } = await supabase
    .from('controller_learned_compensation')
    .select('id, learned_pi_correction, accumulated_integral')
    .eq('controller_id', fc.controller_id)
    .eq('delta_bucket', 'active')
    .eq('mode', fc.cooling_enabled ? 'cooling' : 'heating')
    .limit(1).maybeSingle()

  // Hoist boostOldTarget so it's accessible in both branches and logAdjustment
  const boostOldTarget = parseFloat(String(recentBoost[0].old_target_temp))

  if (existingComp) {
    // PID-based un-boost: reverse the learned correction
    const newCorrection = Math.max(0, existingComp.learned_pi_correction - boostDeg)
    const newIntegral = Math.max(0, existingComp.accumulated_integral - boostDeg)
    await supabase.from('controller_learned_compensation')
      .update({
        learned_pi_correction: newCorrection,
        accumulated_integral: newIntegral,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingComp.id)

    log('STALL_UNBOOST', 'action', `${fc.name}: Jäsning återupptagits, PID -${boostDeg.toFixed(1)}°C`)
  } else {
    // Direct un-boost: the boost was applied as a direct temp change, reverse it
    const restoredTarget = boostOldTarget // restore to pre-boost hardware target, not virtual profile target

    if (Math.abs(currentTarget - restoredTarget) >= 0.15) {
      let success: boolean
      if (ctx.updateBatch) {
        ctx.updateBatch.add(fc.controller_id, restoredTarget, currentTarget)
        success = true
      } else {
        success = await setControllerTargetTemp(supabaseUrl, serviceRoleKey, fc.controller_id, restoredTarget)
      }
      if (success) {
        if (!ctx.updateBatch) {
          await supabase.from('rapt_temp_controllers')
            .update({ target_temp: restoredTarget, updated_at: new Date().toISOString() })
            .eq('controller_id', fc.controller_id)
        }
        log('STALL_UNBOOST', 'action', `${fc.name}: Jäsning återupptagits, direkt un-boost ${currentTarget}°C → ${restoredTarget}°C${ctx.updateBatch ? ' (batched)' : ''}`)
      } else {
        log('STALL_UNBOOST', 'fail', `${fc.name}: Kunde inte reversera direkt boost`)
        return
      }
    } else {
      log('STALL_UNBOOST', 'info', `${fc.name}: Direkt boost redan återställd (${currentTarget}°C ≈ ${restoredTarget}°C)`)
      return
    }
  }

  await logAdjustment(supabase, {
    cooler_controller_id: fc.controller_id,
    cooler_controller_name: fc.name,
    old_target_temp: currentTarget,
    new_target_temp: existingComp ? currentTarget : boostOldTarget,
    original_target_temp: effectiveProfileTarget,
    lowest_followed_temp: currentTarget,
    followed_controller_id: fc.controller_id,
    followed_controller_name: fc.name,
    followed_current_temp: parseFloat(String(fc.pill_temp ?? fc.current_temp ?? 0)),
    followed_target_temp: effectiveProfileTarget,
    reason: `🔄 Un-boost: aktivitet ${activityScore}%, fas ${phase}, ${existingComp ? 'PID' : 'direkt'} -${boostDeg.toFixed(1)}°C`,
  })
}
