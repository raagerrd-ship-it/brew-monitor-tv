-- Enable REPLICA IDENTITY FULL for brew_readings to ensure complete data in realtime updates
ALTER TABLE public.brew_readings REPLICA IDENTITY FULL;