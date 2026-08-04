DROP TABLE IF EXISTS public.auto_cooling_decision_logs CASCADE;
DROP TABLE IF EXISTS public.auto_cooling_adjustments CASCADE;
DROP TABLE IF EXISTS public.auto_cooling_followed_controllers CASCADE;
DROP TABLE IF EXISTS public.auto_cooling_settings CASCADE;
DROP TABLE IF EXISTS public.pending_rapt_retries CASCADE;
DROP TABLE IF EXISTS public.pid_event_throttle CASCADE;
DROP TABLE IF EXISTS public.rapt_token_cache CASCADE;

DROP FUNCTION IF EXISTS public.trigger_auto_cooling_adjustment() CASCADE;
DROP FUNCTION IF EXISTS public.trigger_execute_pwm_off() CASCADE;