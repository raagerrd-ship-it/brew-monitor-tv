import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Pill } from 'lucide-react';
import { Card } from './ui/card';

interface PillData {
  id: string;
  pill_id: string;
  name: string;
  color: string;
  battery_level: number;
  last_update: string | null;
}

export const RaptPills = () => {
  const [pills, setPills] = useState<PillData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPills();
    
    // Subscribe to realtime updates
    const channel = supabase
      .channel('rapt_pills_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rapt_pills'
        },
        () => {
          loadPills();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const loadPills = async () => {
    try {
      const { data, error } = await supabase
        .from('rapt_pills')
        .select('*')
        .order('name', { ascending: true });

      if (error) {
        console.error('Error loading Pills:', error);
        return;
      }

      setPills(data || []);
    } catch (error) {
      console.error('Error loading Pills:', error);
    } finally {
      setLoading(false);
    }
  };

  const getBatteryColor = (level: number) => {
    if (level > 50) return 'text-green-500';
    if (level > 20) return 'text-yellow-500';
    return 'text-red-500';
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center gap-4 py-4">
        <div className="animate-pulse">Laddar Pills...</div>
      </div>
    );
  }

  if (pills.length === 0) {
    return null;
  }

  return (
    <div className="flex justify-center items-center gap-4 mb-6">
      {pills.map((pill) => (
        <Card 
          key={pill.id}
          className="flex items-center gap-3 px-4 py-3 bg-card/50 backdrop-blur-sm border border-border/50 hover:border-primary/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Pill 
              size={24} 
              style={{ color: pill.color }}
              className="drop-shadow-lg"
            />
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">{pill.name}</span>
              <span className={`text-sm font-bold ${getBatteryColor(pill.battery_level)}`}>
                {pill.battery_level}%
              </span>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
};
