
-- Add bg_image_url columns to sonos_now_playing
ALTER TABLE public.sonos_now_playing
  ADD COLUMN IF NOT EXISTS bg_image_url text,
  ADD COLUMN IF NOT EXISTS next_bg_image_url text;

-- Create sonos-backgrounds storage bucket (public)
INSERT INTO storage.buckets (id, name, public)
VALUES ('sonos-backgrounds', 'sonos-backgrounds', true)
ON CONFLICT (id) DO NOTHING;

-- Public read policy for sonos-backgrounds
CREATE POLICY "Public read access for sonos-backgrounds"
ON storage.objects FOR SELECT
USING (bucket_id = 'sonos-backgrounds');

-- Service role write policy for sonos-backgrounds (edge functions use service role)
CREATE POLICY "Service role write access for sonos-backgrounds"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'sonos-backgrounds');

CREATE POLICY "Service role update access for sonos-backgrounds"
ON storage.objects FOR UPDATE
USING (bucket_id = 'sonos-backgrounds');

CREATE POLICY "Service role delete access for sonos-backgrounds"
ON storage.objects FOR DELETE
USING (bucket_id = 'sonos-backgrounds');
