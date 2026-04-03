
-- Drop stall_boost_outcomes table
DROP TABLE IF EXISTS public.stall_boost_outcomes;

-- Drop deprecated stall-boost columns from auto_cooling_settings
ALTER TABLE public.auto_cooling_settings
  DROP COLUMN IF EXISTS auto_boost_enabled,
  DROP COLUMN IF EXISTS auto_boost_degrees,
  DROP COLUMN IF EXISTS stall_rate_threshold,
  DROP COLUMN IF EXISTS stall_min_attenuation,
  DROP COLUMN IF EXISTS stall_max_attenuation;

-- Drop deprecated overshoot columns from auto_cooling_settings
ALTER TABLE public.auto_cooling_settings
  DROP COLUMN IF EXISTS overshoot_prevention_enabled,
  DROP COLUMN IF EXISTS overshoot_delta_threshold,
  DROP COLUMN IF EXISTS overshoot_pill_threshold;

-- Drop deprecated smart relay columns from auto_cooling_settings
ALTER TABLE public.auto_cooling_settings
  DROP COLUMN IF EXISTS smart_relay_enabled,
  DROP COLUMN IF EXISTS smart_relay_cooling_only_below,
  DROP COLUMN IF EXISTS smart_relay_heating_only_above,
  DROP COLUMN IF EXISTS smart_relay_min_hysteresis,
  DROP COLUMN IF EXISTS smart_relay_tighten_after_minutes;

-- Drop deprecated smart relay columns from rapt_temp_controllers
ALTER TABLE public.rapt_temp_controllers
  DROP COLUMN IF EXISTS smart_relay_active,
  DROP COLUMN IF EXISTS smart_relay_off_target_since,
  DROP COLUMN IF EXISTS pre_smart_heating_enabled,
  DROP COLUMN IF EXISTS pre_smart_cooling_enabled,
  DROP COLUMN IF EXISTS pre_smart_heating_hysteresis,
  DROP COLUMN IF EXISTS pre_smart_cooling_hysteresis,
  DROP COLUMN IF EXISTS pre_kick_cooling_hysteresis,
  DROP COLUMN IF EXISTS pwm_stable_count;

-- Drop redundant sync_settings columns
ALTER TABLE public.sync_settings
  DROP COLUMN IF EXISTS last_rapt_sync_at,
  DROP COLUMN IF EXISTS last_sync_time,
  DROP COLUMN IF EXISTS sync_interval,
  DROP COLUMN IF EXISTS rapt_full_sync_interval;
