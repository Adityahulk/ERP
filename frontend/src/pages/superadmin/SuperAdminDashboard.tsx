import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CheckCircle2, Copy } from 'lucide-react';
import toast from 'react-hot-toast';
import { fetchSuperAdminStats } from '@/lib/superAdminApi';
import ActivateLicenseModal from '@/components/superadmin/ActivateLicenseModal';

const SUPPORT_PHONE = '+91-9876543210';

function appLoginUrl(): string {
  const u = import.meta.env.VITE_APP_URL;
  if (u && String(u).trim()) return String(u).trim().replace(/\/$/, '');
  return window.location.origin;
}

function formatCredentialsBlock(opts: {
  companyName: string;
  adminEmail: string;
  adminPassword: string;
  tierLabel: string;
  maxUsers: number;
  expiresDays: number;
}) {
  const planYears = opts.expiresDays >= 365 ? `${Math.round(opts.expiresDays / 365)} year(s)` : `${opts.expiresDays} days`;
  return `─────────────────────────
BizFlow ERP — Access Credentials
Company: ${opts.companyName}
Login URL: ${appLoginUrl()}
Email: ${opts.adminEmail}
Password: ${opts.adminPassword}
Plan: ${opts.tierLabel} (${opts.maxUsers} users, ${planYears})
Support: ${SUPPORT_PHONE}
─────────────────────────`;
}

export default function SuperAdminDashboard() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['superadmin', 'stats'], queryFn: fetchSuperAdminStats });
  const [modal, setModal] = useState<{ id: string; tier: string; maxUsers: number } | null>(null);
  const [cred, setCred] = useState<{
    companyName: string;
    adminEmail: string;
    adminPassword: string;
    tierLabel: string;
    maxUsers: number;
    expiresDays: number;
  } | null>(null);

  if (isLoading || !data) {
    return <div className="text-slate-500 text-sm">Loading dashboard…</div>;
  }

  const stats = [
    { label: 'Total licenses', value: data.total_licenses },
    { label: 'Pending', value: data.pending_licenses },
    { label: 'Active', value: data.active_licenses },
    { label: 'Companies', value: data.total_companies },
    { label: 'Users', value: data.total_users },
    { label: 'Revenue potential (₹)', value: data.revenue_potential.toLocaleString('en-IN') },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-slate-500 text-sm mt-1">Licenses, tenants, and platform activity.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{s.label}</p>
            <p className="text-2xl font-semibold text-slate-900 mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      {cred && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 text-emerald-800 font-semibold mb-3">
            <CheckCircle2 className="w-5 h-5" />
            Credentials ready
          </div>
          <pre className="text-xs bg-white border border-emerald-100 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap font-mono text-slate-800">
            {formatCredentialsBlock(cred)}
          </pre>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(formatCredentialsBlock(cred));
              toast.success('Copied to clipboard');
            }}
            className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-emerald-800 hover:text-emerald-900"
          >
            <Copy className="w-4 h-4" />
            Copy all
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="font-semibold text-slate-900">New license requests</h2>
          <p className="text-xs text-slate-500 mt-0.5">Last pending requests — activate when payment is confirmed.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide">
                <th className="px-4 py-3">Registrant</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Tier</th>
                <th className="px-4 py-3">Requested</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.recent_requests?.length ? (
                data.recent_requests.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-3 font-medium text-slate-800">{r.registrant_name}</td>
                    <td className="px-4 py-3 text-slate-600">{r.registrant_email}</td>
                    <td className="px-4 py-3 text-slate-600">{r.registrant_phone || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{r.tier_display_name}</td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                      {new Date(r.requested_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          setModal({
                            id: r.id,
                            tier: r.tier_display_name,
                            maxUsers: r.tier_max_users,
                          })
                        }
                        className="text-violet-600 font-medium hover:underline"
                      >
                        Activate
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    No pending requests.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <h2 className="font-semibold text-slate-900 mb-4">Recent activity</h2>
        <ul className="space-y-3 text-sm">
          {(data.recent_activity || []).length ? (
            data.recent_activity.map((a, i) => (
              <li key={`${a.license_id}-${i}`} className="flex flex-wrap gap-2 text-slate-700">
                <span className="font-medium capitalize text-violet-700">{a.event_type}</span>
                <span className="text-slate-400">·</span>
                <span>{a.registrant_name}</span>
                {a.company_name && (
                  <>
                    <span className="text-slate-400">→</span>
                    <span>{a.company_name}</span>
                  </>
                )}
                <span className="text-slate-400 ml-auto text-xs">
                  {a.event_at ? new Date(a.event_at).toLocaleString() : '—'}
                </span>
              </li>
            ))
          ) : (
            <li className="text-slate-500">No activations or revocations yet.</li>
          )}
        </ul>
      </div>

      {modal && (
        <ActivateLicenseModal
          licenseId={modal.id}
          tierDisplayName={modal.tier}
          maxUsers={modal.maxUsers}
          open
          onClose={() => setModal(null)}
          onActivated={() => void qc.invalidateQueries({ queryKey: ['superadmin'] })}
          onSuccessCredentials={(p) => setCred(p)}
        />
      )}
    </div>
  );
}
