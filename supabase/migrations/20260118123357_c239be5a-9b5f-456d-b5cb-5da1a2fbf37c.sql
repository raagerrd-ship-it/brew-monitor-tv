-- Create a table to cache external timer data for public viewing
CREATE TABLE public.cached_external_timer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_user_id text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT false,
  label text,
  remaining_seconds integer NOT NULL DEFAULT 0,
  total_seconds integer NOT NULL DEFAULT 0,
  is_paused boolean NOT NULL DEFAULT false,
  paused_by_milestone boolean NOT NULL DEFAULT false,
  milestones jsonb NOT NULL DEFAULT '[]'::jsonb,
  next_milestone jsonb,
  time_to_next_milestone integer,
  progress numeric NOT NULL DEFAULT 0,
  last_synced_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.cached_external_timer ENABLE ROW LEVEL SECURITY;

-- Anyone can view cached timer (public read)
CREATE POLICY "Anyone can view cached timer"
ON public.cached_external_timer
FOR SELECT
USING (true);

-- Anyone can insert/update cached timer (for syncing)
CREATE POLICY "Anyone can insert cached timer"
ON public.cached_external_timer
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Anyone can update cached timer"
ON public.cached_external_timer
FOR UPDATE
USING (true);

-- Enable realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE public.cached_external_timer;