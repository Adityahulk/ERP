import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, CheckCircle2, XCircle, Users, Building2,
  Calendar, Key, Clock, AlertCircle, Shield,
} from 'lucide-react';
import toast from 'react-hot-toast';
import registrantApi from '@/lib/registrantApi';
import { useRegistrantStore } from '@/store/registrantStore';

interface LicenseDetail {
  id: string;
  license_key: string;
  status: string;
  tier_name: string;
  tier_display_name: string;
  max_users: number;
  price_inr: number;
  activated_at: string | null;
  expires_at: string | null;
  requested_at: string;
  notes: string | null;
  company_id: string | null;
  company_name: string | null;
  company_email: string | null;
  company_phone: string | null;
  features: { key: string; label: string; included: boolean }[];
}

interface EmpUser {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
}

const STATUS_ICON: Record<string, any> = {
  pending: Clock,
  active: CheckCircle2,
  expired: AlertCircle,
  revoked: XCircle,
};

const STATUS_COLOR: Record<string, string> = {
  pending: 'text-amber-400',
  active: 'text-emerald-400',
  expired: 'text-slate-400',
  revoked: 'text-red-400',
};

function formatDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const ROLE_LABELS: Record<string, string> = {
  company_admin: 'Admin',
  manager: 'Manager',
  accountant: 'Accountant',
  cashier: 'Cashier',
  staff: 'Staff',
  super_admin: 'Super Admin',
};

export default function LicenseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAuthenticated } = useRegistrantStore();
  const [license, setLicense] = useState<LicenseDetail | null>(null);
  const [users, setUsers] = useState<EmpUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) { navigate('/register/login'); return; }
    fetchData();
  }, [id, isAuthenticated]);

  const fetchData = async () => {
    try {
      const { data: res } = await registrantApi.get(`/licenses/${id}`);
      if (res.success) {
        setLicense(res.data.license);
        setUsers(res.data.users);
      }
    } catch {
      toast.error('Failed to load license details');
      navigate('/register/dashboard');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-[#2d0444] to-slate-900 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!license) return null;

  const StatusIcon = STATUS_ICON[license.status] || Clock;
  const statusColor = STATUS_COLOR[license.status] || 'text-slate-400';
  const usedUsers = users.filter((u) => u.is_active).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-[#2d0444] to-slate-900">
      <div className="border-b border-white/10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/register/dashboard" className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm">
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>
          <img src="/logo-microtechnique.svg" alt="Microtechnique Accounts" className="h-12 drop-shadow" />
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">{license.tier_display_name} License</h1>
            <p className="text-slate-400 text-sm mt-1">
              {license.company_name || 'Awaiting activation'}
            </p>
          </div>
          <div className={`flex items-center gap-2 ${statusColor}`}>
            <StatusIcon className="w-5 h-5" />
            <span className="font-semibold capitalize">{license.status}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left — main info */}
          <div className="lg:col-span-2 space-y-6">
            {/* License details card */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
                <Shield className="w-4 h-4 text-purple-400" />
                License Details
              </h2>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-slate-400 mb-1 flex items-center gap-1"><Key className="w-3 h-3" /> License Key</p>
                  <p className="text-white font-mono text-xs bg-white/5 px-2 py-1.5 rounded break-all">{license.license_key}</p>
                </div>
                <div>
                  <p className="text-slate-400 mb-1">Plan</p>
                  <p className="text-white font-medium">{license.tier_display_name}</p>
                </div>
                <div>
                  <p className="text-slate-400 mb-1 flex items-center gap-1"><Calendar className="w-3 h-3" /> Requested</p>
                  <p className="text-white">{formatDate(license.requested_at)}</p>
                </div>
                <div>
                  <p className="text-slate-400 mb-1 flex items-center gap-1"><Calendar className="w-3 h-3" /> Activated</p>
                  <p className="text-white">{formatDate(license.activated_at)}</p>
                </div>
                <div>
                  <p className="text-slate-400 mb-1 flex items-center gap-1"><Calendar className="w-3 h-3" /> Expires</p>
                  <p className="text-white">{formatDate(license.expires_at)}</p>
                </div>
                <div>
                  <p className="text-slate-400 mb-1 flex items-center gap-1"><Users className="w-3 h-3" /> User Seats</p>
                  <p className="text-white">{usedUsers} / {license.max_users} used</p>
                </div>
              </div>

              {license.status === 'active' && (
                <div className="mt-4">
                  <div className="flex justify-between text-xs text-slate-400 mb-1">
                    <span>User seat usage</span>
                    <span>{Math.round((usedUsers / license.max_users) * 100)}%</span>
                  </div>
                  <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-purple-500 to-purple-400 rounded-full transition-all"
                      style={{ width: `${Math.min((usedUsers / license.max_users) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Company info */}
            {license.company_id && (
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
                <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-purple-400" />
                  Company
                </h2>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-slate-400 mb-1">Name</p>
                    <p className="text-white font-medium">{license.company_name}</p>
                  </div>
                  {license.company_email && (
                    <div>
                      <p className="text-slate-400 mb-1">Email</p>
                      <p className="text-white">{license.company_email}</p>
                    </div>
                  )}
                  {license.company_phone && (
                    <div>
                      <p className="text-slate-400 mb-1">Phone</p>
                      <p className="text-white">{license.company_phone}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Users table */}
            {users.length > 0 && (
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
                <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
                  <Users className="w-4 h-4 text-purple-400" />
                  ERP Users ({users.length})
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-slate-400 border-b border-white/10">
                        <th className="text-left pb-2 font-medium">Name</th>
                        <th className="text-left pb-2 font-medium">Email</th>
                        <th className="text-left pb-2 font-medium">Role</th>
                        <th className="text-left pb-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {users.map((u) => (
                        <tr key={u.id}>
                          <td className="py-2.5 text-white">{u.name}</td>
                          <td className="py-2.5 text-slate-400">{u.email || '—'}</td>
                          <td className="py-2.5 text-slate-300">{ROLE_LABELS[u.role] || u.role}</td>
                          <td className="py-2.5">
                            <span className={`inline-flex items-center gap-1 text-xs ${u.is_active ? 'text-emerald-400' : 'text-slate-500'}`}>
                              {u.is_active ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                              {u.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Right — features sidebar */}
          <div className="space-y-6">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <h2 className="text-white font-semibold mb-4">Plan Features</h2>
              <ul className="space-y-2">
                {license.features.map((f) => (
                  <li key={f.key} className={`flex items-center gap-2 text-sm ${f.included ? 'text-slate-300' : 'text-slate-600'}`}>
                    {f.included
                      ? <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      : <XCircle className="w-4 h-4 text-slate-600 flex-shrink-0" />
                    }
                    {f.label}
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <h2 className="text-white font-semibold mb-3">Need help?</h2>
              <p className="text-slate-400 text-sm mb-4">
                Contact our support team for any questions about your license.
              </p>
              <a
                href="tel:+919876543210"
                className="flex items-center gap-2 text-purple-300 hover:text-purple-200 text-sm transition-colors mb-2"
              >
                <span>📞 +91-9876543210</span>
              </a>
              <a
                href="mailto:sales@microtechnique.in"
                className="flex items-center gap-2 text-purple-300 hover:text-purple-200 text-sm transition-colors"
              >
                <span>✉️ sales@microtechnique.in</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
