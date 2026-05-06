-- Keep deployed databases aligned with the current public pricing.
UPDATE license_tiers
SET price_inr = CASE name
  WHEN 'silver' THEN 9999
  WHEN 'gold' THEN 18999
  WHEN 'diamond' THEN 30999
  ELSE price_inr
END,
updated_at = NOW()
WHERE name IN ('silver', 'gold', 'diamond')
  AND price_inr IS DISTINCT FROM CASE name
    WHEN 'silver' THEN 9999
    WHEN 'gold' THEN 18999
    WHEN 'diamond' THEN 30999
    ELSE price_inr
  END;
