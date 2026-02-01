import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import { BrewCard } from "@/components/brew-card/BrewCard";
import type { BrewData, PillData, TempController, BrewEvent, FermentationSessionData, FermentationStepData } from "@/types/brew";
import { formatDistanceToNow } from "date-fns";
import { sv } from "date-fns/locale";
import { calculateFermentationRate } from "@/lib/brew-utils";

interface SGDataPoint {
  date: string;
  value: number;
  temp: number;
}

interface BrewReading {
  id: string;
  batch_id: string;
  name: string;
  style: string;
  batch_number: string;
  status: string;
  current_sg: number;
  current_temp: number;
  attenuation: number;
  abv: number;
  original_gravity: number;
  final_gravity: number;
  last_update: string | null;
  sg_data: SGDataPoint[];
  battery: number | null;
  linked_controller_id: string | null;
  linked_pill_id: string | null;
  fermentation_start: string | null;
  coldcrash_acknowledged: boolean;
}

export default function Brew() {
  const { id } = useParams<{ id: string }>();
  const [brew, setBrew] = useState<BrewData | null>(null);
  const [pills, setPills] = useState<PillData[]>([]);
  const [controllers, setControllers] = useState<TempController[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setError("Ingen öl-ID angiven");
      setLoading(false);
      return;
    }

    const fetchBrew = async () => {
      try {
        // Fetch brew reading, events, pills, controllers, and fermentation session in parallel
        const [brewResponse, eventsResponse, pillsResponse, controllersResponse] = await Promise.all([
          supabase
            .from('brew_readings')
            .select('*')
            .eq('batch_id', id)
            .single(),
          supabase
            .from('brew_events')
            .select('*'),
          supabase
            .from('rapt_pills')
            .select('id, pill_id, name, color, battery_level, last_update'),
          supabase
            .from('rapt_temp_controllers')
            .select('id, controller_id, name, current_temp, pill_temp, target_temp, last_update, min_target_temp, max_target_temp, cooling_enabled, heating_enabled, heating_utilisation, linked_pill_id')
        ]);

        if (brewResponse.error) {
          // Try finding by ID instead of batch_id
          const byIdResponse = await supabase
            .from('brew_readings')
            .select('*')
            .eq('id', id)
            .single();
          
          if (byIdResponse.error) {
            setError("Ölen hittades inte");
            setLoading(false);
            return;
          }
          
          brewResponse.data = byIdResponse.data;
        }

        const reading = brewResponse.data as unknown as BrewReading;
        
        // Filter events for this brew
        const brewEvents: BrewEvent[] = (eventsResponse.data || [])
          .filter(e => e.brew_id === reading.id)
          .map(e => ({
            id: e.id,
            brew_id: e.brew_id,
            event_type: e.event_type,
            event_date: e.event_date,
            notes: e.notes,
            created_at: e.created_at,
            updated_at: e.updated_at
          }));

        // Fetch fermentation session if exists
        let fermentationSession: FermentationSessionData | undefined;
        const sessionResponse = await supabase
          .from('fermentation_sessions')
          .select(`
            id,
            profile_id,
            controller_id,
            brew_id,
            current_step_index,
            step_started_at,
            step_start_temp,
            status,
            started_at,
            completed_at,
            fermentation_profiles (
              id,
              name,
              description,
              fermentation_profile_steps (
                id,
                step_order,
                step_type,
                target_temp,
                duration_hours,
                gravity_stable_days,
                gravity_threshold,
                target_sg,
                sg_comparison,
                ramp_type,
                notes
              )
            )
          `)
          .eq('brew_id', reading.id)
          .eq('status', 'running')
          .maybeSingle();

        // Find linked controller for session data
        const linkedController = (controllersResponse.data || []).find(
          c => c.controller_id === reading.linked_controller_id
        );

        if (sessionResponse.data) {
          const session = sessionResponse.data;
          const profile = session.fermentation_profiles as any;
          const steps: FermentationStepData[] = (profile?.fermentation_profile_steps || [])
            .sort((a: any, b: any) => a.step_order - b.step_order)
            .map((step: any) => ({
              id: step.id,
              step_order: step.step_order,
              step_type: step.step_type,
              target_temp: step.target_temp,
              duration_hours: step.duration_hours,
              gravity_stable_days: step.gravity_stable_days,
              target_sg: step.target_sg,
              sg_comparison: step.sg_comparison,
              ramp_type: step.ramp_type
            }));

          fermentationSession = {
            id: session.id,
            profile_id: session.profile_id,
            controller_id: session.controller_id,
            current_step_index: session.current_step_index,
            step_started_at: session.step_started_at,
            step_start_temp: session.step_start_temp,
            status: session.status,
            started_at: session.started_at,
            profile_name: profile?.name || 'Okänd profil',
            steps,
            controller_current_temp: linkedController?.current_temp ?? null,
            controller_target_temp: linkedController?.target_temp ?? null
          };
        }

        // Calculate fermentation rate
        const sgData = reading.sg_data || [];
        const fermentationRate = calculateFermentationRate(sgData);

        // Format last update
        const lastUpdate = reading.last_update
          ? formatDistanceToNow(new Date(reading.last_update), { addSuffix: true, locale: sv })
          : "Aldrig";

        const brewData: BrewData = {
          id: reading.id,
          batch_id: reading.batch_id,
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
          fermentationSession
        };

        setBrew(brewData);
        setPills(pillsResponse.data || []);
        setControllers(controllersResponse.data || []);
      } catch (err) {
        console.error('Error fetching brew:', err);
        setError("Kunde inte hämta öl-data");
      } finally {
        setLoading(false);
      }
    };

    fetchBrew();
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !brew) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground mb-2">Ölen hittades inte</h1>
          <p className="text-muted-foreground">{error || "Kontrollera att länken är korrekt"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-2xl mx-auto">
        <BrewCard
          brew={brew}
          updatedFields={{}}
          isAuthenticated={false}
          pills={pills}
          controllers={controllers}
          onShareBrew={() => {}}
          onEventsChange={() => {}}
          onDeviceLinkOpen={() => {}}
          isTvMode={false}
          cardIndex={0}
        />
      </div>
    </div>
  );
}
