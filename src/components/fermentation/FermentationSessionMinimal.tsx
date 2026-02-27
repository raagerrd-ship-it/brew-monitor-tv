import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Play, Pause } from "lucide-react";
import { getStepTypeLabel } from "@/types/fermentation";

interface MinimalSessionData {
  profileName: string;
  status: string;
  currentStepIndex: number;
  totalSteps: number;
  currentStepType: string;
}

interface FermentationSessionMinimalProps {
  controllerId: string;
}

export function FermentationSessionMinimal({ controllerId }: FermentationSessionMinimalProps) {
  const [data, setData] = useState<MinimalSessionData | null>(null);

  useEffect(() => {
    const fetchSession = async () => {
      const { data: sessions } = await supabase
        .from('fermentation_sessions')
        .select('id, status, current_step_index, profile_id, controller_id')
        .eq('controller_id', controllerId)
        .in('status', ['running', 'paused'])
        .limit(1);

      if (!sessions || sessions.length === 0) {
        setData(null);
        return;
      }

      const session = sessions[0];

      const [profileRes, stepsRes] = await Promise.all([
        supabase.from('fermentation_profiles').select('name').eq('id', session.profile_id).single(),
        supabase.from('fermentation_profile_steps').select('id, step_type').eq('profile_id', session.profile_id).order('step_order'),
      ]);

      const steps = stepsRes.data || [];
      const currentStep = steps[session.current_step_index];

      setData({
        profileName: profileRes.data?.name || 'Profil',
        status: session.status,
        currentStepIndex: session.current_step_index,
        totalSteps: steps.length,
        currentStepType: currentStep?.step_type || 'hold',
      });
    };

    fetchSession();
  }, [controllerId]);

  if (!data) return null;

  const StatusIcon = data.status === 'paused' ? Pause : Play;
  const statusColor = data.status === 'paused' ? 'hsl(38 92% 55%)' : 'hsl(var(--ferment-green))';

  return (
    <div
      className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 border"
      style={{
        background: `linear-gradient(135deg, ${statusColor}10, ${statusColor}05)`,
        borderColor: `${statusColor}30`,
      }}
    >
      <StatusIcon className="w-3.5 h-3.5 shrink-0" style={{ color: statusColor }} />
      <div className="flex-1 min-w-0">
        <span className="text-xs font-semibold text-foreground truncate block">{data.profileName}</span>
        <span className="text-[10px] text-muted-foreground">
          {getStepTypeLabel(data.currentStepType)} · {data.currentStepIndex + 1}/{data.totalSteps}
        </span>
      </div>
      <span
        className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
        style={{ background: `${statusColor}20`, color: statusColor }}
      >
        {data.status === 'paused' ? 'Pausad' : 'Körs'}
      </span>
    </div>
  );
}
