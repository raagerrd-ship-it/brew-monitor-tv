-- Seed-omskalning för kontinuerlig ΔT-normalisering (ΔT_ref = 10°).
-- Antar historisk genomsnittlig ΔT ~ 8° enligt 14-dagars-data.
-- Efter denna omskalning står lagrade värden i "ΔT_ref=10°"-referensram
-- och koden kommer omedelbart applicera motsvarande denormalisering vid läsning.
UPDATE public.fermentation_learnings
   SET learned_value = ROUND((learned_value * (10.0 / 8.0))::numeric, 6)
 WHERE parameter_name LIKE 'process_gain:%';

UPDATE public.fermentation_learnings
   SET learned_value = ROUND((learned_value * (8.0 / 10.0))::numeric, 6)
 WHERE parameter_name LIKE 'feedforward_duty:%';