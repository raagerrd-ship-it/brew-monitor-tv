-- Add column to link pill to temp controller
ALTER TABLE rapt_temp_controllers 
ADD COLUMN IF NOT EXISTS linked_pill_id text;