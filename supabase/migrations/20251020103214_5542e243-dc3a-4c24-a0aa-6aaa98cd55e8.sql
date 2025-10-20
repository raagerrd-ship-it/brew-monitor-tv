-- Add column to store pill temperature for temperature controllers
ALTER TABLE public.rapt_temp_controllers
ADD COLUMN pill_temp numeric;

COMMENT ON COLUMN public.rapt_temp_controllers.pill_temp IS 'Temperature from connected pill/hydrometer (controlDeviceTemperature from RAPT API)';
