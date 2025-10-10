-- Enable REPLICA IDENTITY FULL to get old values in realtime updates
ALTER TABLE public.brew_readings REPLICA IDENTITY FULL;