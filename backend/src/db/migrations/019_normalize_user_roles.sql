UPDATE users
SET role = CASE
  WHEN role IN ('company_admin', 'accountant') THEN 'admin'
  WHEN role IN ('manager', 'cashier') THEN 'manager'
  WHEN role = 'super_admin' THEN 'super_admin'
  ELSE 'staff'
END
WHERE role IN (
  'company_admin',
  'accountant',
  'manager',
  'cashier',
  'warehouse',
  'sales',
  'purchase'
);
