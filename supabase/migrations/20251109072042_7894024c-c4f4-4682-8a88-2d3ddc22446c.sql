-- Add columns to store manual device connections for brews
ALTER TABLE brew_readings 
ADD COLUMN linked_controller_id text,
ADD COLUMN linked_pill_id text;

-- Add comment explaining the columns
COMMENT ON COLUMN brew_readings.linked_controller_id IS 'Manually selected RAPT Temperature Controller ID';
COMMENT ON COLUMN brew_readings.linked_pill_id IS 'Manually selected RAPT Pill ID';