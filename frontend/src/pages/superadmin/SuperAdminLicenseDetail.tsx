import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { fetchSuperAdminLicenseDetail, revokeSuperAdminLicense, extendSuperAdminLicense } from '@/lib/superAdminApi';
import ActivateLicenseModal from '@/components/superadmin/ActivateLicenseModal';
import ManageLicensePlanModal from '@/components/superadmin/ManageLicensePlanModal';

export default function SuperAdminLicenseDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [showActivate, setShowActivate] = useState(false);
  const [showPlan, setShowPlan] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['superadmin', 'license', id],
    queryFn: () => fetchSuperAdminLicenseDetail(id!),
    enabled: !!id,
  });

  if (!id) return null;
  if (isLoading || !data) {
    return <div className="text-slate-500 text-sm">Loading…</div>;
  }

  const lic = data.license as Record<string, unknown>;
  const status = String(lic.status);
  const users = data.users as Record<string, unknown>[];

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-3 text-sm">
        <Link to="/superadmin/licenses" className="text-violet-600 hover:underline">
          ← Licenses
        </Link>
      </div>
      <h1 className="text-2xl font-bold text-slate-900">License {String(lic.license_key).slice(0, 12)}…</h1>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h2 className="font-semibold text-slate-900 mb-3">Registrant</h2>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-slate-500">Name</dt>
              <dd className="font-medium">{String(lic.registrant_name)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Email</dt>
              <dd>{String(lic.registrant_email)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Phone</dt>
              <dd>{lic.registrant_phone ? String(lic.registrant_phone) : '—'}</dd>
            </div>
          </dl>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h2 className="font-semibold text-slate-900 mb-3">Tier</h2>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-slate-500">Plan</dt>
              <dd className="font-medium">{String(lic.tier_display_name)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Max users / Price</dt>
              <dd>
                {String(lic.tier_max_users)} seats · ₹{Number(lic.tier_price_inr).toLocaleString('en-IN')}
              </dd>
            </div>
          </dl>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm md:col-span-2">
          <h2 className="font-semibold text-slate-900 mb-3">Company</h2>
          {lic.company_id ? (
            <dl className="grid sm:grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-slate-500">Name</dt>
                <dd className="font-medium">{String(lic.company_name)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Email / GSTIN</dt>
                <dd>
                  {lic.company_email ? String(lic.company_email) : '—'} / {lic.company_gstin ? String(lic.company_gstin) : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Link</dt>
                <dd>
                  <Link className="text-violet-600 hover:underline" to={`/superadmin/companies/${String(lic.company_id)}`}>
                    Open company
                  </Link>
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-slate-500 text-sm">Not activated yet.</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {status === 'pending' && (
          <button
            type="button"
            onClick={() => setShowActivate(true)}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700"
          >
            Activate
          </button>
        )}
        {(status === 'active' || status === 'trial') && (
          <>
            <button
              type="button"
              onClick={async () => {
                const daysStr = window.prompt('Extend by days?', '30');
                if (!daysStr) return;
                const days = parseInt(daysStr, 10);
                if (!days) return;
                try {
                  await extendSuperAdminLicense(id, days);
                  toast.success('Extended');
                  void qc.invalidateQueries({ queryKey: ['superadmin', 'license', id] });
                } catch (e: unknown) {
                  toast.error((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed');
                }
              }}
              className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-800 hover:bg-slate-50"
            >
              Extend
            </button>
            <button
              type="button"
              onClick={() => setShowPlan(true)}
              className="px-4 py-2 rounded-lg border border-blue-300 text-sm font-medium text-blue-800 hover:bg-blue-50"
            >
              Change / Give Plan
            </button>
            {status === 'active' && (
            <button
              type="button"
              onClick={async () => {
                if (!window.confirm('Revoke license and deactivate company?')) return;
                const reason = window.prompt('Reason (optional)') || undefined;
                try {
                  await revokeSuperAdminLicense(id, reason);
                  toast.success('Revoked');
                  void qc.invalidateQueries({ queryKey: ['superadmin', 'license', id] });
                } catch (e: unknown) {
                  toast.error((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed');
                }
              }}
              className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700"
            >
              Revoke
            </button>
            )}
          </>
        )}
        {!!lic.company_id && (
          <Link
            to={`/superadmin/companies/${String(lic.company_id)}`}
            className="px-4 py-2 rounded-lg border border-violet-300 text-sm font-medium text-violet-800 hover:bg-violet-50 inline-flex items-center"
          >
            Add user
          </Link>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <h2 className="font-semibold text-slate-900 mb-3">Timeline</h2>
        <ul className="text-sm space-y-2 text-slate-700">
          <li>Requested: {lic.requested_at ? new Date(String(lic.requested_at)).toLocaleString() : '—'}</li>
          <li>Activated: {lic.activated_at ? new Date(String(lic.activated_at)).toLocaleString() : '—'}</li>
          <li>Expires: {lic.expires_at ? new Date(String(lic.expires_at)).toLocaleString() : '—'}</li>
          {status === 'revoked' && data.timeline?.revoked_at != null && (
            <li>Revoked: {new Date(String((data.timeline as { revoked_at?: string }).revoked_at)).toLocaleString()}</li>
          )}
        </ul>
      </div>

      {users.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 font-semibold text-slate-900">Users</div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-600 uppercase">
              <tr>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-left">Email</th>
                <th className="px-4 py-2 text-left">Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => (
                <tr key={String(u.id)}>
                  <td className="px-4 py-2 font-medium">{String(u.name)}</td>
                  <td className="px-4 py-2 text-slate-600">{String(u.email)}</td>
                  <td className="px-4 py-2">
                    <span className="text-xs font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-700">{String(u.role)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.notes_history?.length ? (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h2 className="font-semibold text-slate-900 mb-3">Notes history</h2>
          <ul className="text-sm text-slate-700 space-y-1 font-mono">
            {data.notes_history.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {showActivate && (
        <ActivateLicenseModal
          licenseId={id}
          tierDisplayName={String(lic.tier_display_name)}
          maxUsers={Number(lic.tier_max_users)}
          open={showActivate}
          onClose={() => setShowActivate(false)}
          onActivated={() => {
            void qc.invalidateQueries({ queryKey: ['superadmin', 'license', id] });
            void qc.invalidateQueries({ queryKey: ['superadmin'] });
          }}
          onSuccessCredentials={() => toast.success('License activated')}
        />
      )}
      {showPlan && (
        <ManageLicensePlanModal
          open
          licenseId={id}
          currentTierId={String(lic.tier_id || '')}
          currentStatus={status}
          onClose={() => setShowPlan(false)}
          onUpdated={() => {
            void qc.invalidateQueries({ queryKey: ['superadmin', 'license', id] });
            void qc.invalidateQueries({ queryKey: ['superadmin'] });
          }}
        />
      )}
    </div>
  );
}
