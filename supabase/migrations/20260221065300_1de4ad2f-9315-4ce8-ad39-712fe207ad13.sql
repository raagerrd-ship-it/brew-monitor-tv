ALTER TABLE public.fermentation_step_log DROP CONSTRAINT fermentation_step_log_action_check;

ALTER TABLE public.fermentation_step_log ADD CONSTRAINT fermentation_step_log_action_check 
CHECK (action = ANY (ARRAY[
  'started'::text, 
  'temp_adjusted'::text, 
  'temp_enforced'::text,
  'condition_met'::text, 
  'completed'::text, 
  'paused'::text, 
  'resumed'::text, 
  'cancelled'::text,
  'skipped'::text,
  'acknowledged'::text
]));