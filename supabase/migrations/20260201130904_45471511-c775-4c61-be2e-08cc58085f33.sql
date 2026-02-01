-- Add short share_id column for sharing URLs
ALTER TABLE public.brew_readings 
ADD COLUMN share_id text UNIQUE;

-- Create a function to generate short random IDs
CREATE OR REPLACE FUNCTION generate_share_id(length integer DEFAULT 6)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  chars text := 'abcdefghjkmnpqrstuvwxyz23456789';
  result text := '';
  i integer;
BEGIN
  FOR i IN 1..length LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  RETURN result;
END;
$$;

-- Generate share_ids for existing brews
UPDATE public.brew_readings 
SET share_id = generate_share_id(6)
WHERE share_id IS NULL;

-- Create a trigger to auto-generate share_id on insert
CREATE OR REPLACE FUNCTION set_share_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  new_id text;
  attempts integer := 0;
BEGIN
  IF NEW.share_id IS NULL THEN
    LOOP
      new_id := generate_share_id(6);
      -- Check if this ID already exists
      IF NOT EXISTS (SELECT 1 FROM brew_readings WHERE share_id = new_id) THEN
        NEW.share_id := new_id;
        EXIT;
      END IF;
      attempts := attempts + 1;
      IF attempts > 10 THEN
        -- Fall back to longer ID if too many collisions
        NEW.share_id := generate_share_id(8);
        EXIT;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_share_id_trigger
BEFORE INSERT ON public.brew_readings
FOR EACH ROW
EXECUTE FUNCTION set_share_id();

-- Add index for fast lookups
CREATE INDEX idx_brew_readings_share_id ON public.brew_readings(share_id);