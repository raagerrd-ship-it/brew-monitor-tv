
-- Table to store complete data snapshots at each SG reading
CREATE TABLE public.brew_data_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brew_id uuid NOT NULL REFERENCES public.brew_readings(id) ON DELETE CASCADE,
  recorded_at timestamp with time zone NOT NULL,
  sg numeric NOT NULL,
  pill_temp numeric NOT NULL,
  controller_temp numeric,
  profile_target_temp numeric,
  auto_target_temp numeric,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Index for fast lookups by brew
CREATE INDEX idx_brew_data_snapshots_brew_id ON public.brew_data_snapshots(brew_id, recorded_at DESC);

-- Unique constraint to prevent duplicate entries for same brew+time
CREATE UNIQUE INDEX idx_brew_data_snapshots_unique ON public.brew_data_snapshots(brew_id, recorded_at);

-- Enable RLS
ALTER TABLE public.brew_data_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view brew data snapshots"
ON public.brew_data_snapshots FOR SELECT USING (true);

CREATE POLICY "Service role can insert brew data snapshots"
ON public.brew_data_snapshots FOR INSERT WITH CHECK (true);

CREATE POLICY "Service role can delete brew data snapshots"
ON public.brew_data_snapshots FOR DELETE USING (true);
