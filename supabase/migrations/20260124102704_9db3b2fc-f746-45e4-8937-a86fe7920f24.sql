-- Create sonos_tokens table for OAuth tokens
CREATE TABLE public.sonos_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  household_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.sonos_tokens ENABLE ROW LEVEL SECURITY;

-- Only service role can manage tokens (edge functions)
CREATE POLICY "Service role can manage sonos tokens" 
ON public.sonos_tokens 
FOR ALL 
USING (true)
WITH CHECK (true);

-- Create sonos_settings table for user preferences
CREATE TABLE public.sonos_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  selected_group_id TEXT,
  selected_group_name TEXT,
  show_on_dashboard BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.sonos_settings ENABLE ROW LEVEL SECURITY;

-- Anyone can view and manage settings
CREATE POLICY "Anyone can view sonos settings" 
ON public.sonos_settings 
FOR SELECT 
USING (true);

CREATE POLICY "Anyone can insert sonos settings" 
ON public.sonos_settings 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Anyone can update sonos settings" 
ON public.sonos_settings 
FOR UPDATE 
USING (true);

-- Create sonos_now_playing table for cached playback state
CREATE TABLE public.sonos_now_playing (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id TEXT NOT NULL,
  track_name TEXT,
  artist_name TEXT,
  album_name TEXT,
  album_art_url TEXT,
  playback_state TEXT NOT NULL DEFAULT 'IDLE',
  duration_ms INTEGER,
  position_ms INTEGER,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.sonos_now_playing ENABLE ROW LEVEL SECURITY;

-- Anyone can view now playing
CREATE POLICY "Anyone can view sonos now playing" 
ON public.sonos_now_playing 
FOR SELECT 
USING (true);

-- Service role can manage now playing
CREATE POLICY "Service role can insert sonos now playing" 
ON public.sonos_now_playing 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Service role can update sonos now playing" 
ON public.sonos_now_playing 
FOR UPDATE 
USING (true);

-- Enable realtime for now playing
ALTER PUBLICATION supabase_realtime ADD TABLE public.sonos_now_playing;

-- Create updated_at triggers
CREATE TRIGGER update_sonos_tokens_updated_at
BEFORE UPDATE ON public.sonos_tokens
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_sonos_settings_updated_at
BEFORE UPDATE ON public.sonos_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_sonos_now_playing_updated_at
BEFORE UPDATE ON public.sonos_now_playing
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();