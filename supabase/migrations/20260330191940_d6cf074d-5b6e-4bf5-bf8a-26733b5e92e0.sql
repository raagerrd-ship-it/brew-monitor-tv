ALTER TABLE public.sonos_now_playing
  ADD COLUMN IF NOT EXISTS volume smallint,
  ADD COLUMN IF NOT EXISTS mute boolean,
  ADD COLUMN IF NOT EXISTS bass smallint,
  ADD COLUMN IF NOT EXISTS treble smallint,
  ADD COLUMN IF NOT EXISTS loudness boolean,
  ADD COLUMN IF NOT EXISTS crossfade boolean,
  ADD COLUMN IF NOT EXISTS media_type text,
  ADD COLUMN IF NOT EXISTS track_number smallint,
  ADD COLUMN IF NOT EXISTS track_uri text,
  ADD COLUMN IF NOT EXISTS nr_tracks smallint;