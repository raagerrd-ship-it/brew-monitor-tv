ALTER TABLE public.brew_data_snapshots
  ADD COLUMN IF NOT EXISTS sg_raw numeric,
  ADD COLUMN IF NOT EXISTS sg_k numeric;

ALTER TABLE public.brew_status
  ADD COLUMN IF NOT EXISTS sg_current_raw numeric,
  ADD COLUMN IF NOT EXISTS sg_k numeric;

COMMENT ON COLUMN public.brew_data_snapshots.sg_raw IS 'Okorrigerad SG som pillen rapporterade. sg är korrigerad till 20 C.';
COMMENT ON COLUMN public.brew_data_snapshots.sg_k IS 'Residualfaktor per pill som anvandes for korrigeringen (SG/C).';