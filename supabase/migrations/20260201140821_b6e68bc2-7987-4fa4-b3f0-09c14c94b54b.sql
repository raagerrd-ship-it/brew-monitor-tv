-- Add label_image_url column to brew_readings
ALTER TABLE public.brew_readings 
ADD COLUMN label_image_url text;

-- Create storage bucket for brew labels
INSERT INTO storage.buckets (id, name, public)
VALUES ('brew-labels', 'brew-labels', true)
ON CONFLICT (id) DO NOTHING;

-- Allow anyone to view brew labels (public bucket)
CREATE POLICY "Anyone can view brew labels"
ON storage.objects FOR SELECT
USING (bucket_id = 'brew-labels');

-- Allow authenticated users to upload brew labels
CREATE POLICY "Authenticated users can upload brew labels"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'brew-labels' AND auth.uid() IS NOT NULL);

-- Allow authenticated users to update their brew labels
CREATE POLICY "Authenticated users can update brew labels"
ON storage.objects FOR UPDATE
USING (bucket_id = 'brew-labels' AND auth.uid() IS NOT NULL);

-- Allow authenticated users to delete brew labels
CREATE POLICY "Authenticated users can delete brew labels"
ON storage.objects FOR DELETE
USING (bucket_id = 'brew-labels' AND auth.uid() IS NOT NULL);