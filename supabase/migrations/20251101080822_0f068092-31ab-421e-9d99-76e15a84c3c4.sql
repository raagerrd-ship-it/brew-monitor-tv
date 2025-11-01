-- Allow anyone to read rapt_pills
CREATE POLICY "Anyone can view rapt pills"
ON public.rapt_pills
FOR SELECT
USING (true);

-- Allow anyone to read rapt_temp_controllers  
CREATE POLICY "Anyone can view rapt temp controllers"
ON public.rapt_temp_controllers
FOR SELECT
USING (true);