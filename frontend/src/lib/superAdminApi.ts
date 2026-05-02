import api from '@/lib/api';

function unwrap<T>(res: { data: unknown }): T {
  const d = res.data as { data?: T; success?: boolean };
  return (d?.data !== undefined ? d.data : res.data) as T;
}

export type LicenseStatusFilter = 'all' | 'pending' | 'active' | 'revoked';

export interface SuperAdminStats {
  total_licenses: number;
  pending_licenses: number;
  active_licenses: number;
  revoked_licenses: number;
  total_companies: number;
  total_users: number;
  revenue_potential: number;
  recent_requests: Array<{
    id: string;
    requested_at: string;
    registrant_name: string;
    registrant_email: string;
    registrant_phone: string | null;
    tier_name: string;
    tier_display_name: string;
    tier_max_users: number;
  }>;
  recent_activity: Array<{
    license_id: string;
    license_key: string;
    event_type: string;
    event_at: string | null;
    registrant_name: string;
    company_name: string | null;
  }>;
}

export interface Paginated<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export interface LicenseRow {
  id: string;
  license_key: string;
  status: string;
  requested_at: string;
  activated_at: string | null;
  expires_at: string | null;
  notes: string | null;
  registrant_name: string;
  registrant_email: string;
  registrant_phone: string | null;
  tier_name: string;
  tier_display_name: string;
  tier_price_inr: number;
  tier_max_users: number;
  company_id: string | null;
  company_name: string | null;
  company_email: string | null;
  company_gstin: string | null;
  user_count: number;
}

export interface CompanyRow {
  id: string;
  name: string;
  email: string | null;
  gstin: string | null;
  is_active: boolean;
  created_at: string;
  plan_type: string | null;
  license_id: string | null;
  license_key: string | null;
  license_status: string | null;
  activated_at: string | null;
  expires_at: string | null;
  tier_display_name: string | null;
  tier_name: string | null;
  user_count: number;
}

export async function fetchSuperAdminStats(): Promise<SuperAdminStats> {
  const res = await api.get('/superadmin/stats');
  return unwrap<SuperAdminStats>(res);
}

export async function fetchSuperAdminLicenses(params: {
  status?: LicenseStatusFilter;
  page?: number;
  limit?: number;
  q?: string;
}): Promise<Paginated<LicenseRow>> {
  const res = await api.get('/superadmin/licenses', { params });
  return unwrap<Paginated<LicenseRow>>(res);
}

export async function fetchSuperAdminLicenseDetail(id: string) {
  const res = await api.get(`/superadmin/licenses/${id}`);
  return unwrap<{
    license: Record<string, unknown>;
    users: unknown[];
    notes_history: string[];
    timeline: Record<string, unknown>;
  }>(res);
}

export async function activateSuperAdminLicense(
  id: string,
  body: {
    company_name: string;
    admin_name: string;
    admin_email: string;
    admin_password: string;
    expires_days?: number;
    notes?: string;
  }
) {
  const res = await api.post(`/superadmin/licenses/${id}/activate`, body);
  return unwrap<{
    company: { id: string; name: string };
    admin_user: { id: string; name: string; email: string; role: string };
    admin_password: string;
    license_key: string;
    tier: string;
    max_users: number;
    expires_at: string;
  }>(res);
}

export async function revokeSuperAdminLicense(id: string, reason?: string) {
  const res = await api.put(`/superadmin/licenses/${id}/revoke`, { reason });
  return unwrap<{ license: { id: string; license_key: string; status: string }; message: string }>(res);
}

export async function extendSuperAdminLicense(id: string, days: number) {
  const res = await api.put(`/superadmin/licenses/${id}/extend`, { days });
  return unwrap<{ license: { id: string; license_key: string; status: string; expires_at: string } }>(res);
}

export async function fetchSuperAdminCompanies(params: {
  page?: number;
  limit?: number;
  q?: string;
}): Promise<Paginated<CompanyRow>> {
  const res = await api.get('/superadmin/companies', { params });
  return unwrap<Paginated<CompanyRow>>(res);
}

export async function fetchSuperAdminCompanyDetail(id: string) {
  const res = await api.get(`/superadmin/companies/${id}`);
  return unwrap<{ company: Record<string, unknown>; users: Record<string, unknown>[] }>(res);
}

export async function addSuperAdminCompanyUser(
  companyId: string,
  body: { name: string; email: string; password: string; role: string }
) {
  const res = await api.post(`/superadmin/companies/${companyId}/users`, body);
  return unwrap<Record<string, unknown>>(res);
}

export async function toggleSuperAdminUser(userId: string) {
  const res = await api.put(`/superadmin/users/${userId}/toggle`);
  return unwrap<{ user: Record<string, unknown> }>(res);
}
