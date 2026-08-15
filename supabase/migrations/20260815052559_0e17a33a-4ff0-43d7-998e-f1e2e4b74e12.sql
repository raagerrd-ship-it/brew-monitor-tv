CREATE OR REPLACE FUNCTION public.archive_empty_brew_drafts()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.brew_readings b
  SET status = 'Arkiverad'
  WHERE b.status IN ('Fermenting', 'Jäsning')
    AND b.linked_controller_id IS NULL
    AND b.linked_pill_id IS NULL
    AND b.created_at < now() - interval '24 hours'
    AND NOT EXISTS (SELECT 1 FROM public.brew_data_snapshots s WHERE s.brew_id = b.id)
    AND NOT EXISTS (SELECT 1 FROM public.fermentation_sessions f WHERE f.brew_id = b.id);
$$;

SELECT cron.schedule(
  'archive-empty-brew-drafts',
  '0 * * * *',
  'SELECT public.archive_empty_brew_drafts();'
);

SELECT public.archive_empty_brew_drafts();