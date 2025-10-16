import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AirVent } from "lucide-react";
import { cn } from "@/lib/utils";

interface TempController {
  id: string;
  controller_id: string;
  name: string;
  current_temp: number | null;
  target_temp: number | null;
  last_update: string | null;
}

interface RaptTempControllersProps {
  dynamicSize?: boolean;
  className?: string;
}

export function RaptTempControllers({ dynamicSize = false, className }: RaptTempControllersProps) {
  const [controllers, setControllers] = useState<TempController[]>([]);

  useEffect(() => {
    loadControllers();

    // Set up realtime subscription
    const channel = supabase
      .channel('temp-controllers-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rapt_temp_controllers'
        },
        () => {
          loadControllers();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const loadControllers = async () => {
    const { data, error } = await supabase
      .from('rapt_temp_controllers')
      .select('*')
      .order('name');

    if (error) {
      console.error('Error loading temperature controllers:', error);
      return;
    }

    setControllers(data || []);
  };

  if (controllers.length === 0) {
    return null;
  }

  const containerStyle = dynamicSize 
    ? { 
        containerType: 'inline-size' as const,
        width: 'min(calc(500cqh * 0.5), calc(100cqw * 0.18))',
      }
    : {};

  const iconStyle = dynamicSize
    ? {
        width: 'min(calc(90cqh * 0.5), calc(100cqw * 0.042))',
        height: 'min(calc(90cqh * 0.5), calc(100cqw * 0.042))',
      }
    : { width: '2rem', height: '2rem' };

  const textStyle = dynamicSize
    ? {
        fontSize: 'min(calc(60cqh * 0.5), calc(100cqw * 0.028))',
      }
    : { fontSize: '1.25rem' };

  return (
    <div className={cn("flex gap-3", className)} style={containerStyle}>
      {controllers.map((controller) => (
        <div 
          key={controller.id}
          className="flex items-center gap-2 rounded-lg bg-background/50 backdrop-blur-sm px-3 py-2"
        >
          <div className="flex items-center justify-center">
            <AirVent 
              style={iconStyle}
              className="text-primary"
            />
          </div>
          <div className="flex flex-col leading-none">
            <span 
              className="font-bold tabular-nums text-foreground"
              style={textStyle}
            >
              {controller.current_temp !== null ? `${controller.current_temp.toFixed(1)}°C` : '--°C'}
            </span>
            {controller.target_temp !== null && (
              <span 
                className="text-muted-foreground/70 text-xs"
                style={{ fontSize: dynamicSize ? 'min(calc(36cqh * 0.5), calc(100cqw * 0.017))' : '0.7rem' }}
              >
                ↗ {controller.target_temp.toFixed(1)}°C
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
