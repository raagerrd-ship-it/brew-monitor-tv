-- Add auto-management settings to sync_settings table
ALTER TABLE sync_settings 
ADD COLUMN IF NOT EXISTS auto_hide_completed boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS auto_hide_conditioning boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS auto_activate_fermenting boolean DEFAULT true;