-- Create table for storing selected brews
CREATE TABLE public.selected_brews (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id text NOT NULL UNIQUE,
  display_order integer NOT NULL,
  is_visible boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.selected_brews ENABLE ROW LEVEL SECURITY;

-- Create policies - allow public read access since this is a dashboard
CREATE POLICY "Anyone can view selected brews"
  ON public.selected_brews
  FOR SELECT
  USING (true);

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_selected_brews_updated_at
  BEFORE UPDATE ON public.selected_brews
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add index for better performance
CREATE INDEX idx_selected_brews_visible ON public.selected_brews(is_visible, display_order);