-- Add RAPT sync interval to sync_settings
ALTER TABLE public.sync_settings 
ADD COLUMN rapt_sync_interval integer DEFAULT 900 NOT NULL;

-- Create table for selected RAPT Pills
CREATE TABLE public.selected_rapt_pills (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pill_id text NOT NULL UNIQUE,
  is_visible boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS for selected_rapt_pills
ALTER TABLE public.selected_rapt_pills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view selected pills"
ON public.selected_rapt_pills
FOR SELECT
USING (true);

CREATE POLICY "Anyone can insert selected pills"
ON public.selected_rapt_pills
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Anyone can update selected pills"
ON public.selected_rapt_pills
FOR UPDATE
USING (true);

CREATE POLICY "Anyone can delete selected pills"
ON public.selected_rapt_pills
FOR DELETE
USING (true);

-- Create table for selected RAPT Temperature Controllers
CREATE TABLE public.selected_rapt_temp_controllers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  controller_id text NOT NULL UNIQUE,
  is_visible boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS for selected_rapt_temp_controllers
ALTER TABLE public.selected_rapt_temp_controllers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view selected temp controllers"
ON public.selected_rapt_temp_controllers
FOR SELECT
USING (true);

CREATE POLICY "Anyone can insert selected temp controllers"
ON public.selected_rapt_temp_controllers
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Anyone can update selected temp controllers"
ON public.selected_rapt_temp_controllers
FOR UPDATE
USING (true);

CREATE POLICY "Anyone can delete selected temp controllers"
ON public.selected_rapt_temp_controllers
FOR DELETE
USING (true);

-- Add triggers for updated_at
CREATE TRIGGER update_selected_rapt_pills_updated_at
BEFORE UPDATE ON public.selected_rapt_pills
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_selected_rapt_temp_controllers_updated_at
BEFORE UPDATE ON public.selected_rapt_temp_controllers
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();