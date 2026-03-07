ALTER TABLE public.rapt_pills
  ADD COLUMN IF NOT EXISTS gravity numeric NULL,
  ADD COLUMN IF NOT EXISTS temperature numeric NULL;