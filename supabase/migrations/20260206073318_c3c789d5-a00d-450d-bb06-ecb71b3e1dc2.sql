
-- Create chart-images storage bucket (public for Chromecast direct access)
INSERT INTO storage.buckets (id, name, public)
VALUES ('chart-images', 'chart-images', true);

-- Allow anyone to read chart images
CREATE POLICY "Chart images are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'chart-images');

-- Allow service role to manage chart images (edge function uses service role)
CREATE POLICY "Service role can manage chart images"
ON storage.objects FOR ALL
USING (bucket_id = 'chart-images')
WITH CHECK (bucket_id = 'chart-images');
