
-- Fix critical race condition: change trigger from FOR EACH ROW to FOR EACH STATEMENT
-- This ensures run-automation is called only ONCE per sync batch, not once per controller row
DROP TRIGGER IF EXISTS automation_on_rapt_update ON rapt_temp_controllers;

CREATE TRIGGER automation_on_rapt_update
  AFTER UPDATE ON rapt_temp_controllers
  FOR EACH STATEMENT
  EXECUTE FUNCTION trigger_automation_on_rapt_update();
