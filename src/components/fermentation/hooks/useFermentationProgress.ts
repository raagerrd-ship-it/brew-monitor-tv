import { useMemo } from "react";
import { FermentationProfileStep } from "@/types/fermentation";

interface SgDataPoint {
  date: string;
  value: number;
  temp: number;
}

interface FermentationProgressInput {
  currentStep?: FermentationProfileStep;
  stepStartedAt: string;
  stepStartTemp?: number | null;
  targetTemp: number | null;
  currentTemp?: number | null;
  currentSg?: number | null;
  targetSg?: number | null;
  originalGravity?: number | null;
  sgData?: SgDataPoint[];
}

interface StabilityDuration {
  days: number;
  hours: number;
}

export interface FermentationProgressResult {
  stabilityDuration: StabilityDuration | null;
  stabilityProgress: number | null;
  sgProgress: number | null;
  isRampTimeComplete: boolean;
  isTargetTempReached: boolean;
  waitingForTemp: boolean;
  tempDifference: string | null;
  isRampingUp: boolean;
  isRamping: boolean;
  rampProgress: number | null;
}

export function useFermentationProgress({
  currentStep,
  stepStartedAt,
  stepStartTemp,
  targetTemp,
  currentTemp,
  currentSg,
  targetSg,
  originalGravity,
  sgData,
}: FermentationProgressInput): FermentationProgressResult {
  
  return useMemo(() => {
    // Calculate stability duration for wait_for_gravity_stable steps
    const calculateStabilityDuration = (): StabilityDuration | null => {
      if (!currentStep || currentStep.step_type !== 'wait_for_gravity_stable') return null;
      if (!sgData || sgData.length < 2) return null;
      
      const threshold = currentStep.gravity_threshold ?? 0.001;
      const sortedData = [...sgData].sort((a, b) => 
        new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      
      if (sortedData.length < 2) return null;
      
      const latestSg = sortedData[0].value;
      let stableFromDate = new Date(sortedData[0].date);
      
      for (let i = 1; i < sortedData.length; i++) {
        const reading = sortedData[i];
        const diff = Math.abs(reading.value - latestSg);
        
        if (diff <= threshold) {
          stableFromDate = new Date(reading.date);
        } else {
          break;
        }
      }
      
      const now = new Date();
      const diffMs = now.getTime() - stableFromDate.getTime();
      const totalHours = diffMs / (1000 * 60 * 60);
      const days = Math.floor(totalHours / 24);
      const hours = Math.floor(totalHours % 24);
      
      return { days, hours };
    };

    const stabilityDuration = calculateStabilityDuration();
    
    // Calculate stability progress (0-1)
    const stabilityProgress = (() => {
      if (!stabilityDuration || !currentStep?.gravity_stable_days) return null;
      const targetHours = currentStep.gravity_stable_days * 24;
      const currentHours = stabilityDuration.days * 24 + stabilityDuration.hours;
      return Math.min(currentHours / targetHours, 1);
    })();

    // Calculate SG progress (0-1)
    const sgProgress = (() => {
      if (targetSg == null || currentSg == null || originalGravity == null) return null;
      if (originalGravity <= targetSg) return null;
      
      const totalDrop = originalGravity - targetSg;
      const currentDrop = originalGravity - currentSg;
      return Math.max(0, Math.min(1, currentDrop / totalDrop));
    })();

    // Check if ramp step time is complete
    const isRampTimeComplete = (() => {
      if (!currentStep || currentStep.step_type !== 'ramp' || !currentStep.duration_hours) {
        return false;
      }
      const stepStarted = new Date(stepStartedAt);
      const elapsedHours = (Date.now() - stepStarted.getTime()) / (1000 * 60 * 60);
      return elapsedHours >= currentStep.duration_hours;
    })();

    // Check if target temp is reached
    const isTargetTempReached = (() => {
      if (!currentStep || currentStep.target_temp == null || currentTemp == null) {
        return false;
      }
      return Math.abs(currentTemp - currentStep.target_temp) <= 0.5;
    })();

    const waitingForTemp = currentStep?.step_type === 'ramp' && isRampTimeComplete && !isTargetTempReached;
    
    const tempDifference = currentStep?.target_temp != null && currentTemp != null 
      ? Math.abs(currentTemp - currentStep.target_temp).toFixed(1) 
      : null;

    const isRampingUp = currentStep?.step_type === 'ramp' && 
      currentStep.target_temp != null && 
      stepStartTemp != null && 
      currentStep.target_temp > stepStartTemp;

    // Determine if currently ramping
    const isRamping = currentStep?.step_type === 'ramp' && 
      currentStep.ramp_type !== 'immediate' && 
      !isRampTimeComplete;

    // Calculate ramp progress
    const rampProgress = (() => {
      if (!isRamping || !currentStep?.duration_hours) return null;
      const stepStarted = new Date(stepStartedAt);
      const elapsedHours = (Date.now() - stepStarted.getTime()) / (1000 * 60 * 60);
      return Math.min(elapsedHours / currentStep.duration_hours, 1);
    })();

    return {
      stabilityDuration,
      stabilityProgress,
      sgProgress,
      isRampTimeComplete,
      isTargetTempReached,
      waitingForTemp,
      tempDifference,
      isRampingUp,
      isRamping,
      rampProgress,
    };
  }, [currentStep, stepStartedAt, stepStartTemp, targetTemp, currentTemp, currentSg, targetSg, originalGravity, sgData]);
}
