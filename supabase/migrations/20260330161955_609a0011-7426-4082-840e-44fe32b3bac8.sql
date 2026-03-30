ALTER TABLE public.sync_settings 
ADD COLUMN chart_smooth_lines boolean NOT NULL DEFAULT true,
ADD COLUMN chart_time_range text NOT NULL DEFAULT 'full';