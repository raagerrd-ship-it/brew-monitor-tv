-- Add last_sync_time to sync_settings table to track when syncs occur
ALTER TABLE sync_settings ADD COLUMN IF NOT EXISTS last_sync_time TIMESTAMP WITH TIME ZONE;