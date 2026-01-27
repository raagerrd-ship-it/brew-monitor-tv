-- Add FPS counter setting to sync_settings
ALTER TABLE public.sync_settings 
ADD COLUMN show_fps_counter boolean NOT NULL DEFAULT false;