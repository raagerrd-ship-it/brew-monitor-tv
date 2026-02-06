ALTER TABLE public.sonos_now_playing ADD COLUMN IF NOT EXISTS next_album_art_url TEXT;
ALTER TABLE public.sonos_now_playing ADD COLUMN IF NOT EXISTS album_art_url_small TEXT;