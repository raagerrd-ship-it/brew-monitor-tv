import { useEffect, useState } from "react";
import type { BrewData, PillData, TempController, BrewEvent, FermentationSessionData, FermentationStepData } from "@/types/brew";
import { formatDistanceToNow } from "date-fns";
import { sv } from "date-fns/locale";
import { calculateFermentationRate, calculateFermentationTrend } from "@/lib/fermentation-calc";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

export function useBrewPage(brewId: string | undefined) {
  const [brew, setBrew] = useState<BrewData | null>(null);
  const [pills, setPills] = useState<PillData[]>([]);
  const [controllers, setControllers] = useState<TempController[]>([]);
  const [pillCompEnabled, setPillCompEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!brewId) {
      setError("Ingen öl-ID angiven");
      setLoading(false);
      return;
    }

    const fetchBrew = async () => {
      try {
        const response = await fetch(
          `${SUPABASE_URL}/functions/v1/get-public-rapt-data?brew_id=${encodeURIComponent(brewId)}`,
          {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
          }
        );

        if (!response.ok) {
          if (response.status === 404) {
            setError("Ölen hittades inte");
            setLoading(false);
            return;
          }
          throw new Error(`HTTP error: ${response.status}`);
        }

        const responseData = await response.json();
        
        if (!responseData.success || !responseData.brew) {
          setError("Ölen hittades inte");
          setLoading(false);
          return;
        }

        const reading = responseData.brew;
        const brewEvents: BrewEvent[] = (responseData.events || []).map((e: any) => ({
          id: e.id,
          brew_id: e.brew_id,
          event_type: e.event_type,
          event_date: e.event_date,
          notes: e.notes,
          created_at: e.created_at,
          updated_at: e.updated_at
        }));

        // Process fermentation session
        let fermentationSession: FermentationSessionData | undefined;
        const sessionData = responseData.fermentationSession;
        // Find the controller for this session (from fermentation session, not brew's linked_controller_id)
        const sessionControllerId = sessionData?.controller_id;
        const linkedController = sessionControllerId 
          ? (responseData.controllers || []).find(
              (c: { controller_id: string }) => c.controller_id === sessionControllerId
            )
          : null;

        if (sessionData) {
          const profile = sessionData.fermentation_profiles as { name?: string; fermentation_profile_steps?: FermentationStepData[] } | null;
          const steps: FermentationStepData[] = (profile?.fermentation_profile_steps || [])
            .sort((a, b) => a.step_order - b.step_order)
            .map((step) => ({
              id: step.id,
              step_order: step.step_order,
              step_type: step.step_type,
              target_temp: step.target_temp,
              duration_hours: step.duration_hours,
              gravity_stable_days: step.gravity_stable_days,
              target_sg: step.target_sg,
              sg_comparison: step.sg_comparison,
              ramp_type: step.ramp_type,
              attenuation_trigger: step.attenuation_trigger,
              activity_trigger: step.activity_trigger,
              temp_increase: step.temp_increase,
              gravity_threshold: step.gravity_threshold,
              min_ramp_hours: step.min_ramp_hours ?? null,
              ramp_curve: step.ramp_curve ?? null,
            }));

          fermentationSession = {
            id: sessionData.id,
            profile_id: sessionData.profile_id,
            controller_id: sessionData.controller_id,
            current_step_index: sessionData.current_step_index,
            step_started_at: sessionData.step_started_at,
            step_start_temp: sessionData.step_start_temp,
            ramp_triggered_at: sessionData.ramp_triggered_at ?? null,
            status: sessionData.status,
            started_at: sessionData.started_at,
            profile_name: profile?.name || 'Okänd profil',
            steps,
            controller_current_temp: linkedController?.current_temp ?? null,
            controller_pill_temp: linkedController?.pill_temp ?? null,
            controller_target_temp: linkedController?.target_temp ?? null,
            controller_profile_target_temp: linkedController?.profile_target_temp ?? null,
          };
        }

        const sgData = reading.sg_data || [];
        const fermentationRate = calculateFermentationRate(sgData);
        const fermentationTrend = calculateFermentationTrend(sgData);

        const lastUpdate = reading.last_update
          ? formatDistanceToNow(new Date(reading.last_update), { addSuffix: true, locale: sv })
          : "Aldrig";

        const brewData: BrewData = {
          id: reading.id,
          batch_id: reading.batch_id,
          share_id: reading.share_id || null,
          name: reading.name,
          style: reading.style,
          batchNumber: reading.batch_number,
          status: reading.status,
          currentSG: reading.current_sg,
          currentTemp: reading.current_temp,
          attenuation: reading.attenuation,
          abv: reading.abv,
          originalGravity: reading.original_gravity,
          finalGravity: reading.final_gravity,
          lastUpdate,
          lastUpdateRaw: reading.last_update,
          sgData,
          battery: reading.battery,
          linked_controller_id: reading.linked_controller_id,
          linked_pill_id: reading.linked_pill_id,
          fermentationRate,
          coldcrashAcknowledged: reading.coldcrash_acknowledged,
          events: brewEvents,
          fermentationSession,
          label_image_url: reading.label_image_url || null,
          description: reading.description || null,
          overshootReason: null,
          originalTarget: null,
          pidReason: null,
          dutyPct: null,
          dutyMode: null,
          fermentationTrend,
        };

        setBrew(brewData);
        setPills(responseData.pills || []);
        setControllers(responseData.controllers || []);
        setPillCompEnabled(responseData.pillCompEnabled ?? false);
      } catch (err) {
        console.error('Error fetching brew:', err);
        setError("Kunde inte hämta öl-data");
      } finally {
        setLoading(false);
      }
    };

    fetchBrew();
  }, [brewId]);

  return { brew, pills, controllers, pillCompEnabled, loading, error };
}
