import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { fetchSuperAdminCompanyDetail, addSuperAdminCompanyUser, toggleSuperAdminUser } from '@/lib/superAdminApi';

const ROLE_OPTIONS = [
  'company_admin',
  'accountant',
  'manager',
  'cashier',
  'staff',
  'warehouse',
  'sales',
  'purchase',
] as const;

export default function SuperAdminCompanyDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'staff' as (typeof ROLE_OPTIONS)[number] });

  const { data, isLoading } = useQuery({
    queryKey: ['superadmin', 'company', id],
    queryFn: () => fetchSuperAdminCompanyDetail(id!),
    enabled: !!id,
  });

  if (!id) return null;
  if (isLoading || !data) {
    return <div className="text-slate-500 text-sm">Loading…</div>;
  }

  const c = data.company;

  return (
    <div className="space-y-6 max-w-5xl">
      <Link to="/superadmin/companies" className="text-sm text-violet-600 hover:underline">
        ← Companies
      </Link>
      <h1 className="text-2xl font-bold text-slate-900">{String(c.name)}</h1>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h2 className="font-semibold text-slate-900 mb-3">Company</h2>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-slate-500">Email</dt>
              <dd>{c.email ? String(c.email) : '—'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">GSTIN</dt>
              <dd>{c.gstin ? String(c.gstin) : '—'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Address</dt>
              <dd className="text-slate-700">
                {[c.registered_address, c.city, c.state, c.pincode].filter(Boolean).join(', ') || '—'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Plan</dt>
              <dd>{c.tier_display_name ? String(c.tier_display_name) : String(c.plan_type || '—')}</dd>
            </div>
          </dl>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h2 className="font-semibold text-slate-900 mb-3">License</h2>
          {c.license_id ? (
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-slate-500">Key</dt>
                <dd className="font-mono text-xs break-all">{String(c.license_key)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Status</dt>
                <dd className="capitalize">{String(c.license_status)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Expiry</dt>
                <dd>{c.license_expires_at ? new Date(String(c.license_expires_at)).toLocaleString() : '—'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Registrant</dt>
                <dd>
                  {c.registrant_name ? String(c.registrant_name) : '—'} ({c.registrant_email ? String(c.registrant_email) : '—'})
                </dd>
              </div>
              <div>
                <Link className="text-violet-600 hover:underline text-sm font-medium" to={`/superadmin/licenses/${String(c.license_id)}`}>
                  Open license
                </Link>
              </div>
            </dl>
          ) : (
            <p className="text-slate-500 text-sm">No license linked.</p>
          )}
        </div>
      </div>

      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-slate-900">Users</h2>
        <button
          type="button"
          onClick={() => setShowAdd((s) => !s)}
          className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700"
        >
          {showAdd ? 'Close form' : 'Add user'}
        </button>
      </div>

      {showAdd && (
        <form
          className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm grid sm:grid-cols-2 gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await addSuperAdminCompanyUser(id, form);
              toast.success('User created');
              setForm({ name: '', email: '', password: '', role: 'staff' });
              setShowAdd(false);
              void qc.invalidateQueries({ queryKey: ['superadmin', 'company', id] });
            } catch (err: unknown) {
              toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed');
            }
          }}
        >
          <div className="sm:col-span-2 text-sm font-medium text-slate-700">New user</div>
          <input
            required
            placeholder="Name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            required
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            required
            placeholder="Password"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <select
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as (typeof ROLE_OPTIONS)[number] }))}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <div className="sm:col-span-2">
            <button type="submit" className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold">
              Create user
            </button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-600 uppercase">
            <tr>
              <th className="px-4 py-2 text-left">Name</th>
              <th className="px-4 py-2 text-left">Email</th>
              <th className="px-4 py-2 text-left">Role</th>
              <th className="px-4 py-2 text-left">Active</th>
              <th className="px-4 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.users.map((u) => (
              <tr key={String(u.id)}>
                <td className="px-4 py-2 font-medium">{String(u.name)}</td>
                <td className="px-4 py-2 text-slate-600">{String(u.email)}</td>
                <td className="px-4 py-2">
                  <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700">{String(u.role)}</span>
                </td>
                <td className="px-4 py-2">{u.is_active ? 'Yes' : 'No'}</td>
                <td className="px-4 py-2 text-right">
                  {String(u.role) !== 'super_admin' && (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await toggleSuperAdminUser(String(u.id));
                          toast.success('Updated');
                          void qc.invalidateQueries({ queryKey: ['superadmin', 'company', id] });
                        } catch (err: unknown) {
                          toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed');
                        }
                      }}
                      className="text-violet-600 font-medium hover:underline"
                    >
                      Toggle active
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
