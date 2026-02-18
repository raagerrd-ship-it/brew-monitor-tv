
-- Create trigger function for fermentation profile processing on RAPT update
CREATE OR REPLACE FUNCTION public.trigger_fermentation_on_rapt_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only trigger if there are running fermentation sessions
  IF EXISTS (SELECT 1 FROM fermentation_sessions WHERE status = 'running' LIMIT 1) THEN
    PERFORM public.trigger_fermentation_profile_processing();
  END IF;
  RETURN NEW;
END;
$$;

-- Create trigger for fermentation profiles - fires when RAPT data updates
CREATE TRIGGER fermentation_on_rapt_update
  AFTER UPDATE ON public.rapt_temp_controllers
  FOR EACH ROW
  WHEN (OLD.last_update IS DISTINCT FROM NEW.last_update)
  EXECUTE FUNCTION public.trigger_fermentation_on_rapt_update();
