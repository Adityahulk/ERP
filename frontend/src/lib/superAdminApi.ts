import api from '@/lib/api';

function unwrap<T>(res: { data: unknown }): T {
  const d = res.data as { data?: T; success?: boolean };
  return (d?.data !== undefined ? d.data : res.data) as T;
}

export type LicenseStatusFilter = 'all' | 'pending' | 'active' | 'expired' | 'trial' | 'expired_trial' | 'revoked';

export interface SuperAdminStats {
  total_licenses: number;
  pending_licenses: number;
  active_licenses: number;
  trial_licenses: number;
  expired_trial_licenses: number;
  revoked_licenses: number;
  total_companies: number;
  total_users: number;
  total_registrants: number;
  new_leads: number;
  verified_registrants: number;
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
  recent_trials: Array<{
    id: string;
    license_key: string;
    requested_at: string;
    activated_at: string | null;
    expires_at: string | null;
    registrant_name: string;
    registrant_email: string;
    registrant_phone: string | null;
    tier_name: string;
    tier_display_name: string;
    tier_max_users: number;
    company_id: string | null;
    company_name: string | null;
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
  tier_id: string;
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

export interface LicenseTierRow {
  id: string;
  name: string;
  display_name: string;
  max_users: number;
  price_inr: number;
  description?: string | null;
  sort_order?: number;
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

export type LeadStatus = 'all' | 'new' | 'contacted' | 'qualified' | 'customer' | 'lost';

export interface RegistrantRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  is_active: boolean;
  is_verified: boolean;
  email_verified_at: string | null;
  last_login_at: string | null;
  created_at: string;
  lead_status: Exclude<LeadStatus, 'all'>;
  lead_source: string;
  admin_notes: string | null;
  last_contacted_at: string | null;
  license_count: number;
  live_license_count: number;
  latest_license_status: string | null;
  license_id: string | null;
  company_id: string | null;
  company_name: string | null;
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

export async function fetchSuperAdminLicenseTiers(): Promise<LicenseTierRow[]> {
  const res = await api.get('/superadmin/license-tiers');
  const payload = unwrap<{ tiers: LicenseTierRow[] }>(res);
  return payload.tiers || [];
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

export async function updateSuperAdminLicensePlan(
  id: string,
  body: { tier_id: string; status?: 'active' | 'trial'; expires_days?: number; expires_at?: string; notes?: string }
) {
  const res = await api.put(`/superadmin/licenses/${id}/plan`, body);
  return unwrap<{ license: Record<string, unknown>; tier: LicenseTierRow }>(res);
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

export async function deleteSuperAdminCompanyUser(userId: string) {
  const res = await api.delete(`/superadmin/users/${userId}`);
  return unwrap<{ message: string; user: Record<string, unknown> }>(res);
}

export async function fetchSuperAdminRegistrants(params: {
  status?: LeadStatus;
  page?: number;
  limit?: number;
  q?: string;
}): Promise<Paginated<RegistrantRow>> {
  const res = await api.get('/superadmin/registrants', { params });
  return unwrap<Paginated<RegistrantRow>>(res);
}

export async function updateSuperAdminRegistrant(
  id: string,
  body: {
    lead_status?: Exclude<LeadStatus, 'all'>;
    admin_notes?: string;
    mark_contacted?: boolean;
    is_active?: boolean;
  },
) {
  const res = await api.put(`/superadmin/registrants/${id}`, body);
  return unwrap<{ registrant: RegistrantRow }>(res);
}

export async function deleteSuperAdminRegistrant(id: string) {
  const res = await api.delete(`/superadmin/registrants/${id}`);
  return unwrap<{ message: string; registrant: Pick<RegistrantRow, 'id' | 'name' | 'email'> }>(res);
}
