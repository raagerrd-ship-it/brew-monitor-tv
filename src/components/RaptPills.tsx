import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Pill } from 'lucide-react';

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
        (payload) => {
          console.log('RAPT Pills realtime update:', payload);
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

  if (loading || pills.length === 0) {
    return null;
  }

  const formatLastUpdate = (timestamp: string | null) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 60) {
      return `${diffMins}m sedan`;
    }
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) {
      return `${diffHours}h sedan`;
    }
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d sedan`;
  };

  return (
    <div className="flex items-center gap-3">
      {pills.map((pill) => (
        <div 
          key={pill.id}
          className="flex items-center gap-1.5"
          title={`${pill.name}\nBatteri: ${pill.battery_level}%\nUppdaterad: ${formatLastUpdate(pill.last_update)}`}
        >
          <Pill 
            size={20} 
            color={pill.color}
            strokeWidth={2.5}
            className="drop-shadow-md"
          />
          <span className={`text-sm font-bold tabular-nums ${getBatteryColor(pill.battery_level)}`}>
            {pill.battery_level}%
          </span>
        </div>
      ))}
    </div>
  );
};
