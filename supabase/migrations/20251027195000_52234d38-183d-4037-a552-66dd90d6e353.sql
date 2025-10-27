-- Update RLS policies for rapt_temp_controllers to require service role for SELECT
DROP POLICY IF EXISTS "Anyone can view temp controllers" ON rapt_temp_controllers;

CREATE POLICY "Service role can select temp controllers"
ON rapt_temp_controllers
FOR SELECT
USING (auth.role() = 'service_role');

-- Update RLS policies for rapt_pills to require service role for SELECT  
DROP POLICY IF EXISTS "Anyone can view pills" ON rapt_pills;

CREATE POLICY "Service role can select pills"
ON rapt_pills
FOR SELECT
USING (auth.role() = 'service_role');