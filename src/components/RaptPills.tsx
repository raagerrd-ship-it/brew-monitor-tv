import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Pill } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

interface PillData {
  id: string;
  pill_id: string;
  name: string;
  color: string;
  battery_level: number;
  last_update: string | null;
}

interface RaptPillsProps {
  iconSize?: number;
}

export const RaptPills = ({ iconSize }: RaptPillsProps) => {
  const [pills, setPills] = useState<PillData[]>([]);
  const [loading, setLoading] = useState(true);
  const isMobile = useIsMobile();

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

  const isStale = (timestamp: string | null): boolean => {
    if (!timestamp) return true;
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    return diffHours > 24;
  };

  const pillSize = iconSize || 32;
  const gap = isMobile ? 'gap-2' : 'gap-4';
  const itemGap = isMobile ? 'gap-1' : 'gap-2';

  return (
    <div className={`flex items-center ${gap}`}>
      {pills.map((pill) => {
        const isInactive = isStale(pill.last_update);
        
        return (
          <div 
            key={pill.id}
            className={`flex items-center ${itemGap} transition-opacity ${isInactive ? 'opacity-50' : ''}`}
            title={`${pill.name}\nBatteri: ${pill.battery_level}%\nUppdaterad: ${formatLastUpdate(pill.last_update)}${isInactive ? '\n⚠️ Ingen uppdatering på >24h' : ''}`}
          >
            <div className="relative">
              <Pill 
                size={pillSize} 
                color={pill.color}
                strokeWidth={2.5}
                className={`drop-shadow-md ${isInactive ? 'animate-pulse' : ''}`}
              />
              {isInactive && (
                <div className={`absolute -top-1 -right-1 ${isMobile ? 'w-1.5 h-1.5' : 'w-2 h-2'} bg-yellow-500 rounded-full border border-background`} />
              )}
            </div>
            <span className="font-bold tabular-nums" style={{ fontSize: `${pillSize * 0.7}px`, color: pill.battery_level > 50 ? 'rgb(34 197 94)' : pill.battery_level > 20 ? 'rgb(234 179 8)' : 'rgb(239 68 68)' }}>
              {pill.battery_level}%
            </span>
          </div>
        );
      })}
    </div>
  );
};
