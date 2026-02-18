
-- Drop the two separate triggers
DROP TRIGGER IF EXISTS auto_cooling_on_rapt_update ON public.rapt_temp_controllers;
DROP TRIGGER IF EXISTS fermentation_on_rapt_update ON public.rapt_temp_controllers;

-- Drop the separate trigger functions
DROP FUNCTION IF EXISTS public.trigger_auto_cooling_on_rapt_update();
DROP FUNCTION IF EXISTS public.trigger_fermentation_on_rapt_update();

-- Create a single unified trigger function
CREATE OR REPLACE FUNCTION public.trigger_automation_on_rapt_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- 1. Fermentation profiles first (may change target temp)
  IF EXISTS (SELECT 1 FROM fermentation_sessions WHERE status = 'running' LIMIT 1) THEN
    PERFORM public.trigger_fermentation_profile_processing();
  END IF;

  -- 2. Auto-cooling second (reacts to current state incl. any fermentation changes)
  IF EXISTS (SELECT 1 FROM auto_cooling_settings WHERE enabled = true LIMIT 1) THEN
    PERFORM public.trigger_auto_cooling_adjustment();
  END IF;

  RETURN NEW;
END;
$$;

-- Create single trigger
CREATE TRIGGER automation_on_rapt_update
  AFTER UPDATE ON public.rapt_temp_controllers
  FOR EACH ROW
  WHEN (OLD.last_update IS DISTINCT FROM NEW.last_update)
  EXECUTE FUNCTION public.trigger_automation_on_rapt_update();
