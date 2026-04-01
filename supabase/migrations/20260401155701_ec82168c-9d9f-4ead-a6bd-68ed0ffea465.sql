ALTER TABLE sonos_now_playing
  ADD COLUMN bg_cached boolean DEFAULT null,
  ADD COLUMN next_bg_cached boolean DEFAULT null,
  ADD COLUMN bg_generation_ms integer DEFAULT null,
  ADD COLUMN next_bg_generation_ms integer DEFAULT null;