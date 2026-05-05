-- Update default license tier prices
UPDATE license_tiers
SET price_inr = CASE name
  WHEN 'silver' THEN 9999
  WHEN 'gold' THEN 18999
  WHEN 'diamond' THEN 30999
  ELSE price_inr
END
WHERE name IN ('silver', 'gold', 'diamond');
