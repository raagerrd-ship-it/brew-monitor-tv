-- Add battery column to brew_readings table
ALTER TABLE brew_readings 
ADD COLUMN battery numeric;