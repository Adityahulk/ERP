const LEGACY_ROLE_MAP: Record<string, 'admin' | 'manager' | 'staff' | 'super_admin'> = {
  admin: 'admin',
  company_admin: 'admin',
  accountant: 'admin',
  manager: 'manager',
  cashier: 'manager',
  staff: 'staff',
  warehouse: 'staff',
  sales: 'staff',
  purchase: 'staff',
  super_admin: 'super_admin',
};

export type NormalizedTenantRole = 'admin' | 'manager' | 'staff' | 'super_admin';

export function normalizeRole(role: unknown): NormalizedTenantRole {
  return LEGACY_ROLE_MAP[String(role || '').trim()] || 'staff';
}

export function roleLevel(role: unknown): number {
  switch (normalizeRole(role)) {
    case 'super_admin':
      return 99;
    case 'admin':
      return 30;
    case 'manager':
      return 20;
    default:
      return 10;
  }
}

export function isAdminRole(role: unknown): boolean {
  const normalized = normalizeRole(role);
  return normalized === 'admin' || normalized === 'super_admin';
}
