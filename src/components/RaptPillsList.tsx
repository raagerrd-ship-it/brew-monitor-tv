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

export const RaptPillsList = () => {
  const [pills, setPills] = useState<PillData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPills();
    
    // Subscribe to realtime updates
    const channel = supabase
      .channel('rapt_pills_list_changes')
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

  const formatDateTime = (timestamp: string | null) => {
    if (!timestamp) return 'Aldrig';
    return new Date(timestamp).toLocaleString('sv-SE', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="text-center py-4">
        <div className="animate-pulse">Laddar Pills...</div>
      </div>
    );
  }

  if (pills.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        Inga Pills hittades. Kör en synkronisering för att hämta dina Pills.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {pills.map((pill) => (
        <Card key={pill.id} className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Pill 
                size={24} 
                color={pill.color}
                strokeWidth={2.5}
                className="drop-shadow-md flex-shrink-0"
              />
              <div>
                <h4 className="font-medium">{pill.name}</h4>
                <p className="text-xs text-muted-foreground">
                  Senast uppdaterad: {formatDateTime(pill.last_update)}
                </p>
              </div>
            </div>
            <div className="text-right">
              <div className={`text-2xl font-bold ${getBatteryColor(pill.battery_level)}`}>
                {pill.battery_level}%
              </div>
              <p className="text-xs text-muted-foreground">Batteri</p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
};
