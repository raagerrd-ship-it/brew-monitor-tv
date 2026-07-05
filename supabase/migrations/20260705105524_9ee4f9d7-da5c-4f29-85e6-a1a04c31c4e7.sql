-- Tillåt Pi-pollern (som använder anon-nyckel på LAN) att markera kommandon som done
-- och rapportera plugg-state. RLS-modellen här är "trusted LAN device with anon key" —
-- samma modell som brew-ble-uploadern.
CREATE POLICY "plug_commands_anon_update"
  ON public.plug_commands
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "plug_commands_anon_insert"
  ON public.plug_commands
  FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "plug_state_anon_update"
  ON public.plug_state
  FOR UPDATE
  TO anon
  USING (id = 1)
  WITH CHECK (id = 1);

GRANT UPDATE, INSERT ON public.plug_commands TO anon;
GRANT UPDATE ON public.plug_state TO anon;