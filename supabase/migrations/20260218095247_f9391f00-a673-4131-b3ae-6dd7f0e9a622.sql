
-- Create trigger function that calls auto-cooling when RAPT data updates
CREATE OR REPLACE FUNCTION public.trigger_auto_cooling_on_rapt_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only trigger if auto cooling is enabled
  IF EXISTS (SELECT 1 FROM auto_cooling_settings WHERE enabled = true LIMIT 1) THEN
    PERFORM public.trigger_auto_cooling_adjustment();
  END IF;
  RETURN NEW;
END;
$$;

-- Create trigger on rapt_temp_controllers - only fires when last_update changes (new RAPT data)
CREATE TRIGGER auto_cooling_on_rapt_update
  AFTER UPDATE ON public.rapt_temp_controllers
  FOR EACH ROW
  WHEN (OLD.last_update IS DISTINCT FROM NEW.last_update)
  EXECUTE FUNCTION public.trigger_auto_cooling_on_rapt_update();
