import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  fetchSuperAdminLicenses,
  revokeSuperAdminLicense,
  extendSuperAdminLicense,
  type LicenseStatusFilter,
} from '@/lib/superAdminApi';
import ActivateLicenseModal from '@/components/superadmin/ActivateLicenseModal';
import ManageLicensePlanModal from '@/components/superadmin/ManageLicensePlanModal';

const TABS: { id: LicenseStatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'active', label: 'Active' },
  { id: 'expired', label: 'Expired' },
  { id: 'trial', label: 'Trials' },
  { id: 'expired_trial', label: 'Expired Trials' },
  { id: 'revoked', label: 'Revoked' },
];

export default function SuperAdminLicenses() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<LicenseStatusFilter>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<{ id: string; tier: string; maxUsers: number } | null>(null);
  const [planModal, setPlanModal] = useState<{ id: string; tierId?: string; status?: string } | null>(null);

  const queryKey = useMemo(() => ['superadmin', 'licenses', tab, q, page] as const, [tab, q, page]);

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchSuperAdminLicenses({ status: tab, q: q.trim() || undefined, page, limit: 25 }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Licenses</h1>
          <p className="text-slate-500 text-sm mt-1">Search by registrant or company name.</p>
        </div>
        <input
          placeholder="Search…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          className="max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      <div className="flex gap-2 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTab(t.id);
              setPage(1);
            }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id ? 'border-violet-600 text-violet-700' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-slate-500 text-sm">Loading…</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide">
                    <th className="px-4 py-3">Registrant</th>
                    <th className="px-4 py-3">Tier</th>
                    <th className="px-4 py-3">Company</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Requested</th>
                    <th className="px-4 py-3">Expires</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data?.data?.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{row.registrant_name}</div>
                        <div className="text-xs text-slate-500">{row.registrant_email}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{row.tier_display_name}</td>
                      <td className="px-4 py-3 text-slate-600">{row.company_name || '—'}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 capitalize">
                          {row.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-xs">
                        {new Date(row.requested_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-xs">
                        {row.expires_at ? new Date(row.expires_at).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                        <Link to={`/superadmin/licenses/${row.id}`} className="text-violet-600 font-medium hover:underline">
                          View
                        </Link>
                        {row.status === 'pending' && (
                          <button
                            type="button"
                            onClick={() =>
                              setModal({
                                id: row.id,
                                tier: row.tier_display_name,
                                maxUsers: row.tier_max_users,
                              })
                            }
                            className="text-emerald-600 font-medium hover:underline"
                          >
                            Activate
                          </button>
                        )}
                        {(row.status === 'active' || row.status === 'trial') && (
                          <>
                            <button
                              type="button"
                              onClick={async () => {
                                const daysStr = window.prompt('Extend license by how many days?', '30');
                                if (!daysStr) return;
                                const days = parseInt(daysStr, 10);
                                if (!days || days < 1) {
                                  toast.error('Invalid number of days');
                                  return;
                                }
                                try {
                                  await extendSuperAdminLicense(row.id, days);
                                  toast.success('License extended');
                                  void qc.invalidateQueries({ queryKey: ['superadmin'] });
                                } catch (e: unknown) {
                                  toast.error((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed');
                                }
                              }}
                              className="text-slate-700 font-medium hover:underline"
                            >
                              Extend
                            </button>
                            <button
                              type="button"
                              onClick={() => setPlanModal({ id: row.id, tierId: row.tier_id, status: row.status })}
                              className="text-blue-700 font-medium hover:underline"
                            >
                              Plan
                            </button>
                            {row.status === 'trial' && (
                              <button
                                type="button"
                                onClick={() => setPlanModal({ id: row.id, tierId: row.tier_id, status: 'active' })}
                                className="text-emerald-700 font-medium hover:underline"
                              >
                                Give paid plan
                              </button>
                            )}
                            {row.status === 'active' && (
                            <button
                              type="button"
                              onClick={async () => {
                                if (!window.confirm('Revoke this license and deactivate the company?')) return;
                                const reason = window.prompt('Reason (optional)') || undefined;
                                try {
                                  await revokeSuperAdminLicense(row.id, reason);
                                  toast.success('License revoked');
                                  void qc.invalidateQueries({ queryKey: ['superadmin'] });
                                } catch (e: unknown) {
                                  toast.error((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed');
                                }
                              }}
                              className="text-red-600 font-medium hover:underline"
                            >
                              Revoke
                            </button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data && data.pagination.totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-sm">
                <span className="text-slate-500">
                  Page {data.pagination.page} of {data.pagination.totalPages}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={!data.pagination.hasPrev}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="px-3 py-1 rounded border border-slate-200 disabled:opacity-40"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    disabled={!data.pagination.hasNext}
                    onClick={() => setPage((p) => p + 1)}
                    className="px-3 py-1 rounded border border-slate-200 disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {modal && (
        <ActivateLicenseModal
          licenseId={modal.id}
          tierDisplayName={modal.tier}
          maxUsers={modal.maxUsers}
          open
          onClose={() => setModal(null)}
          onActivated={() => void qc.invalidateQueries({ queryKey: ['superadmin'] })}
          onSuccessCredentials={() => toast.success('Activated — open license detail to copy credentials if needed')}
        />
      )}
      {planModal && (
        <ManageLicensePlanModal
          open
          licenseId={planModal.id}
          currentTierId={planModal.tierId}
          currentStatus={planModal.status}
          onClose={() => setPlanModal(null)}
          onUpdated={() => {
            void qc.invalidateQueries({ queryKey: ['superadmin'] });
            void qc.invalidateQueries({ queryKey });
          }}
        />
      )}
    </div>
  );
}
