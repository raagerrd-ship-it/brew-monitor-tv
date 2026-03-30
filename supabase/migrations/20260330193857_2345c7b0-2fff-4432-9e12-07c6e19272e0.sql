ALTER TABLE public.sonos_now_playing
  ADD COLUMN IF NOT EXISTS current_uri text,
  ADD COLUMN IF NOT EXISTS next_av_transport_uri text,
  ADD COLUMN IF NOT EXISTS play_medium text,
  ADD COLUMN IF NOT EXISTS stream_content text,
  ADD COLUMN IF NOT EXISTS radio_show_md text,
  ADD COLUMN IF NOT EXISTS original_track_number smallint,
  ADD COLUMN IF NOT EXISTS protocol_info text;