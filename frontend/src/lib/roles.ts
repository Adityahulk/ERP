export type NormalizedRole = 'admin' | 'manager' | 'staff' | 'super_admin';

export function normalizeRole(role?: string | null): NormalizedRole {
  switch (String(role || '').trim()) {
    case 'super_admin':
      return 'super_admin';
    case 'admin':
    case 'company_admin':
    case 'accountant':
      return 'admin';
    case 'manager':
    case 'cashier':
      return 'manager';
    default:
      return 'staff';
  }
}

export function canAccessRole(role: string | null | undefined, allowed: NormalizedRole[]): boolean {
  const actual = normalizeRole(role);
  if (actual === 'super_admin') return true;
  return allowed.includes(actual);
}

export function roleLabel(role?: string | null): string {
  const actual = normalizeRole(role);
  if (actual === 'admin') return 'Admin';
  if (actual === 'manager') return 'Cashier / Manager';
  if (actual === 'super_admin') return 'Super Admin';
  return 'Staff';
}
