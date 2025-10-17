-- Add coldcrash_acknowledged column to brew_readings table
ALTER TABLE brew_readings 
ADD COLUMN coldcrash_acknowledged boolean NOT NULL DEFAULT false;