-- Ensure HR is usable for every existing company, not only newly onboarded ones.
WITH defaults(name, code, days_per_year, is_paid, carry_forward, max_carry_forward) AS (
  VALUES
    ('Casual Leave', 'CL', 12, true, false, 0),
    ('Sick Leave', 'SL', 6, true, false, 0),
    ('Earned Leave', 'EL', 15, true, true, 30),
    ('Leave Without Pay', 'LWP', 0, false, false, 0),
    ('Maternity Leave', 'ML', 182, true, false, 0),
    ('Paternity Leave', 'PL', 7, true, false, 0)
)
INSERT INTO leave_types (company_id, name, code, days_per_year, is_paid, carry_forward, max_carry_forward, is_active)
SELECT c.id, d.name, d.code, d.days_per_year, d.is_paid, d.carry_forward, d.max_carry_forward, true
FROM companies c
CROSS JOIN defaults d
WHERE c.is_deleted = false
  AND NOT EXISTS (
    SELECT 1
    FROM leave_types lt
    WHERE lt.company_id = c.id
      AND (lt.code = d.code OR lower(lt.name) = lower(d.name))
  );
