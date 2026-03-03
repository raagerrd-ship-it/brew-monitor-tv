
-- Smart Relay columns on auto_cooling_settings
ALTER TABLE public.auto_cooling_settings
  ADD COLUMN smart_relay_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN smart_relay_cooling_only_below numeric NOT NULL DEFAULT 15,
  ADD COLUMN smart_relay_heating_only_above numeric NOT NULL DEFAULT 20,
  ADD COLUMN smart_relay_min_hysteresis numeric NOT NULL DEFAULT 0.3,
  ADD COLUMN smart_relay_tighten_after_minutes integer NOT NULL DEFAULT 30;

-- Smart Relay state columns on rapt_temp_controllers
ALTER TABLE public.rapt_temp_controllers
  ADD COLUMN smart_relay_active boolean NOT NULL DEFAULT false,
  ADD COLUMN pre_smart_heating_enabled boolean,
  ADD COLUMN pre_smart_cooling_enabled boolean,
  ADD COLUMN pre_smart_heating_hysteresis numeric,
  ADD COLUMN pre_smart_cooling_hysteresis numeric,
  ADD COLUMN smart_relay_off_target_since timestamptz;
