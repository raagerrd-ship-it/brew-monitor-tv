import { supabase } from '@/integrations/supabase/client';

type Row = Record<string, any>;

// En kanal + en 60 s-poll för sync_settings, delad av alla läsare.
let row: Row | null = null;
const subs = new Set<(r: Row) => void>();
let started = false;

const emit = (r: Row) => {
  row = r;
  subs.forEach((s) => s(r));
};

const load = async () => {
  const { data } = await supabase
    .from('sync_settings')
    .select('id, force_tv_refresh_at, cleaning_checklist, chart_smooth_lines, chart_time_range')
    .limit(1)
    .maybeSingle();
  if (data) emit(data);
};

export function subscribeSyncSettings(cb: (r: Row) => void): () => void {
  subs.add(cb);
  if (row) cb(row);
  if (!started) {
    started = true;
    load();
    supabase
      .channel('sync-settings')
      .on('postgres_changes' as any, { event: 'UPDATE', schema: 'public', table: 'sync_settings' }, (p: any) => {
        if (p.new) emit({ ...row, ...p.new });
      })
      .subscribe();
    setInterval(load, 60000);
  }
  return () => { subs.delete(cb); };
}
