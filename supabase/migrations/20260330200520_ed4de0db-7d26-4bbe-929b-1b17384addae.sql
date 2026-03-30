
-- Ensure sonos-backgrounds bucket exists and is public
INSERT INTO storage.buckets (id, name, public)
VALUES ('sonos-backgrounds', 'sonos-backgrounds', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Allow anon upload (bridge uses anon key)
CREATE POLICY "Allow anon upload to sonos-backgrounds" ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (bucket_id = 'sonos-backgrounds');

-- Allow anon update (for upsert with x-upsert header)
CREATE POLICY "Allow anon update sonos-backgrounds" ON storage.objects
  FOR UPDATE TO anon
  USING (bucket_id = 'sonos-backgrounds');

-- Allow public read (bucket is public but explicit policy helps)
CREATE POLICY "Allow public read sonos-backgrounds" ON storage.objects
  FOR SELECT TO anon
  USING (bucket_id = 'sonos-backgrounds');
