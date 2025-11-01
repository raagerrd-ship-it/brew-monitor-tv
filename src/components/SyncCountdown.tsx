import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface SyncCountdownProps {
  className?: string;
}

export function SyncCountdown({ className = "" }: SyncCountdownProps) {
  const [progress, setProgress] = useState(0);
  const [syncInterval, setSyncInterval] = useState(60); // Default 60 seconds
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);

  useEffect(() => {
    // Load sync interval and last sync time from database
    const loadSyncSettings = async () => {
      try {
        const { data, error } = await supabase
          .from('sync_settings')
          .select('sync_interval, last_sync_time')
          .limit(1)
          .maybeSingle();

        if (error) throw error;
        if (data) {
          setSyncInterval(data.sync_interval);
          if (data.last_sync_time) {
            setLastSyncTime(new Date(data.last_sync_time));
          }
        }
      } catch (error) {
        console.error('Error loading sync settings:', error);
      }
    };

    loadSyncSettings();

    // Subscribe to sync_settings changes to update the interval AND last sync time
    const channel = supabase
      .channel('sync-interval-changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'sync_settings'
        },
        (payload) => {
          const newData = payload.new as any;
          if (newData) {
            if ('sync_interval' in newData) {
              setSyncInterval(newData.sync_interval);
            }
            if ('last_sync_time' in newData && newData.last_sync_time) {
              setLastSyncTime(new Date(newData.last_sync_time));
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    const updateProgress = () => {
      const now = new Date();
      
      // If we have a last sync time, use it for more accurate progress
      if (lastSyncTime) {
        const millisecondsSinceSync = now.getTime() - lastSyncTime.getTime();
        const secondsSinceSync = Math.floor(millisecondsSinceSync / 1000);
        
        // Calculate progress (0 = just synced, 100 = about to sync)
        const progressPercent = Math.min((secondsSinceSync / syncInterval) * 100, 100);
        setProgress(progressPercent);
      } else {
        // Fallback to time-based calculation if no last sync time is available
        const seconds = now.getSeconds();
        const minutes = now.getMinutes();
        
        // Calculate total elapsed seconds in the current hour
        const totalElapsedSeconds = minutes * 60 + seconds;
        
        // Calculate time since last sync based on the interval
        let secondsSinceSync: number;
        
        if (syncInterval >= 3600) {
          // For hourly intervals, count from the top of the hour
          secondsSinceSync = totalElapsedSeconds;
        } else if (syncInterval >= 60) {
          // For minute-based intervals, calculate based on the interval
          const intervalMinutes = Math.floor(syncInterval / 60);
          const minutesSinceSync = minutes % intervalMinutes;
          secondsSinceSync = minutesSinceSync * 60 + seconds;
        } else {
          // For sub-minute intervals (should be rare), use seconds
          secondsSinceSync = seconds % syncInterval;
        }
        
        // Calculate progress (0 = just synced, 100 = about to sync)
        const progressPercent = (secondsSinceSync / syncInterval) * 100;
        setProgress(progressPercent);
      }
    };

    updateProgress();
    const timer = setInterval(updateProgress, 1000);

    return () => clearInterval(timer);
  }, [syncInterval, lastSyncTime]);

  // Calculate stroke-dashoffset for the circular progress
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  return (
    <svg
      className={`absolute inset-0 pointer-events-none ${className}`}
      viewBox="0 0 48 48"
      style={{ transform: 'rotate(-90deg)' }}
    >
      {/* Background circle */}
      <circle
        cx="24"
        cy="24"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="text-muted-foreground/20"
      />
      
      {/* Progress circle */}
      <circle
        cx="24"
        cy="24"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray={circumference}
        strokeDashoffset={strokeDashoffset}
        className="text-primary transition-all duration-1000 ease-linear"
        strokeLinecap="round"
      />
    </svg>
  );
}
