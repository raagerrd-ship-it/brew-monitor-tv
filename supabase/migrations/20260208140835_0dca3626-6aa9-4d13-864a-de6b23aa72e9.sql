ALTER TABLE public.sonos_now_playing ADD COLUMN IF NOT EXISTS widget_art_url TEXT;
ALTER TABLE public.sonos_now_playing ADD COLUMN IF NOT EXISTS next_widget_art_url TEXT;