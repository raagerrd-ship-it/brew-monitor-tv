CREATE POLICY "Anyone can update rapt pills"
ON public.rapt_pills
FOR UPDATE
USING (true)
WITH CHECK (true);