
-- Create storage bucket for pre-processed album backgrounds
INSERT INTO storage.buckets (id, name, public)
VALUES ('album-backgrounds', 'album-backgrounds', true);

-- Public read access
CREATE POLICY "Album backgrounds are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'album-backgrounds');

-- Service role can insert (edge function uses service role key)
CREATE POLICY "Service role can upload album backgrounds"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'album-backgrounds');

-- Service role can delete (for cleanup)
CREATE POLICY "Service role can delete album backgrounds"
ON storage.objects FOR DELETE
USING (bucket_id = 'album-backgrounds');
