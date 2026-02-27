DELETE FROM auto_cooling_decision_logs 
WHERE adjustment_made = false 
AND id != (
  SELECT id FROM auto_cooling_decision_logs 
  WHERE adjustment_made = false 
  ORDER BY created_at DESC 
  LIMIT 1
);