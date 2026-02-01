import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { BrewCard } from "@/components/brew-card/BrewCard";
import type { BrewData, PillData, TempController, BrewEvent, FermentationSessionData, FermentationStepData } from "@/types/brew";
import { formatDistanceToNow } from "date-fns";
import { sv } from "date-fns/locale";
import { calculateFermentationRate } from "@/lib/brew-utils";

// Update document title when brew is loaded
const useDocumentTitle = (title: string | null) => {
  useEffect(() => {
    if (title) {
      document.title = `${title} - Dahlsjö Brewing`;
    }
    return () => {
      document.title = "Bryggövervakare";
    };
  }, [title]);
};

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;


export default function Brew() {
  const { id } = useParams<{ id: string }>();
  const [brew, setBrew] = useState<BrewData | null>(null);
  const [pills, setPills] = useState<PillData[]>([]);
  const [controllers, setControllers] = useState<TempController[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useDocumentTitle(brew?.name ?? null);

  useEffect(() => {
    if (!id) {
      setError("Ingen öl-ID angiven");
      setLoading(false);
      return;
    }

    const fetchBrew = async () => {
      try {
        // Use edge function for public access (no auth required)
        const response = await fetch(
          `${SUPABASE_URL}/functions/v1/get-public-rapt-data?brew_id=${encodeURIComponent(id)}`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
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

        // Process fermentation session from edge function response
        let fermentationSession: FermentationSessionData | undefined;
        const sessionData = responseData.fermentationSession;
        
        // Find linked controller for session data
        const linkedController = (responseData.controllers || []).find(
          (c: any) => c.controller_id === reading.linked_controller_id
        );

        if (sessionData) {
          const profile = sessionData.fermentation_profiles as any;
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
            id: sessionData.id,
            profile_id: sessionData.profile_id,
            controller_id: sessionData.controller_id,
            current_step_index: sessionData.current_step_index,
            step_started_at: sessionData.step_started_at,
            step_start_temp: sessionData.step_start_temp,
            status: sessionData.status,
            started_at: sessionData.started_at,
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
          description: reading.description || null
        };

        setBrew(brewData);
        setPills(responseData.pills || []);
        setControllers(responseData.controllers || []);
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
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Label and description side by side */}
        {(brew.label_image_url || brew.description) && (
          <div className="bg-card/50 backdrop-blur-xl rounded-xl border border-white/10 p-6 shadow-xl">
            <div className="flex flex-col md:flex-row gap-6 items-start">
              {/* Label image */}
              {brew.label_image_url && (
                <div className="flex-shrink-0 mx-auto md:mx-0">
                  <img
                    src={brew.label_image_url}
                    alt={`${brew.name} etikett`}
                    className="max-h-48 md:max-h-64 w-auto rounded-lg shadow-lg border border-white/10"
                  />
                </div>
              )}
              
              {/* Description */}
              {brew.description && (
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-semibold text-foreground mb-3">Om ölet</h3>
                  <p className="text-muted-foreground leading-relaxed whitespace-pre-line text-sm md:text-base">
                    {brew.description}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

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
