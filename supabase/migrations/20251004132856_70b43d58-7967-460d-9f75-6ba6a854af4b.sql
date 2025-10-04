-- Add missing RLS policies for managing selected brews
CREATE POLICY "Anyone can insert selected brews"
  ON public.selected_brews
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update selected brews"
  ON public.selected_brews
  FOR UPDATE
  USING (true);

CREATE POLICY "Anyone can delete selected brews"
  ON public.selected_brews
  FOR DELETE
  USING (true);