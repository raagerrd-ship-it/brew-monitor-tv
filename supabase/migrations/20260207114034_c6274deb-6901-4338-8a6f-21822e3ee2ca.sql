ALTER TABLE public.sonos_settings 
ADD COLUMN IF NOT EXISTS spotify_client_id TEXT,
ADD COLUMN IF NOT EXISTS spotify_client_secret TEXT;