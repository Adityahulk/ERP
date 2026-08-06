import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CheckCircle2, Mail, Pencil, Phone, Trash2, UserRoundSearch, X } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  deleteSuperAdminRegistrant,
  fetchSuperAdminRegistrants,
  type LeadStatus,
  type RegistrantRow,
  updateSuperAdminRegistrant,
} from '@/lib/superAdminApi';

const LEAD_TABS: Array<{ id: LeadStatus; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'new', label: 'New' },
  { id: 'contacted', label: 'Contacted' },
  { id: 'qualified', label: 'Qualified' },
  { id: 'customer', label: 'Customers' },
  { id: 'lost', label: 'Lost' },
];

const STAGE_STYLES: Record<string, string> = {
  new: 'bg-blue-50 text-blue-700 border-blue-200',
  contacted: 'bg-amber-50 text-amber-700 border-amber-200',
  qualified: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  customer: 'bg-violet-50 text-violet-700 border-violet-200',
  lost: 'bg-slate-100 text-slate-600 border-slate-200',
};

function LeadEditor({
  row,
  onClose,
}: {
  row: RegistrantRow;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<Exclude<LeadStatus, 'all'>>(row.lead_status);
  const [notes, setNotes] = useState(row.admin_notes || '');
  const [active, setActive] = useState(row.is_active);
  const [markContacted, setMarkContacted] = useState(false);
  const save = useMutation({
    mutationFn: () => updateSuperAdminRegistrant(row.id, {
      lead_status: status,
      admin_notes: notes,
      is_active: active,
      mark_contacted: markContacted,
    }),
    onSuccess: () => {
      toast.success('Registration updated');
      void qc.invalidateQueries({ queryKey: ['superadmin'] });
      onClose();
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Could not update registration'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-semibold text-slate-900">Manage registration</h2>
            <p className="mt-0.5 truncate text-sm text-slate-500">{row.name} · {row.email}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100" title="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <div>
            <label className="text-xs font-semibold uppercase text-slate-500">Lead stage</label>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as Exclude<LeadStatus, 'all'>)}
              className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
            >
              {LEAD_TABS.filter((item) => item.id !== 'all').map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold uppercase text-slate-500">Internal notes</label>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={5}
              maxLength={5000}
              placeholder="Call outcome, requirement, budget, next follow-up..."
              className="mt-1 w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-start gap-2 rounded-md border border-slate-200 p-3 text-sm">
              <input type="checkbox" checked={markContacted} onChange={(event) => setMarkContacted(event.target.checked)} className="mt-0.5" />
              <span>
                <span className="block font-medium text-slate-800">Contacted now</span>
                <span className="block text-xs text-slate-500">Updates the last-contact timestamp.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 rounded-md border border-slate-200 p-3 text-sm">
              <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} className="mt-0.5" />
              <span>
                <span className="block font-medium text-slate-800">Portal access active</span>
                <span className="block text-xs text-slate-500">Controls license-portal sign in.</span>
              </span>
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
          <button type="button" onClick={onClose} className="h-9 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="h-9 rounded-md bg-slate-900 px-4 text-sm font-medium text-white disabled:opacity-50"
          >
            {save.isPending ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SuperAdminRegistrants() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<LeadStatus>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<RegistrantRow | null>(null);
  const queryKey = useMemo(() => ['superadmin', 'registrants', status, q, page] as const, [status, q, page]);
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchSuperAdminRegistrants({ status, q: q.trim() || undefined, page, limit: 25 }),
  });
  const remove = useMutation({
    mutationFn: deleteSuperAdminRegistrant,
    onSuccess: () => {
      toast.success('Registration deleted');
      void qc.invalidateQueries({ queryKey: ['superadmin'] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Could not delete registration'),
  });

  const deleteRow = (row: RegistrantRow) => {
    if (row.company_id || row.live_license_count > 0) {
      toast.error('Active customers are protected. Manage their license or company instead.');
      return;
    }
    if (!window.confirm(`Delete the registration for ${row.name} (${row.email})? This removes pending license requests but keeps audit logs.`)) return;
    remove.mutate(row.id);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Registrations & Leads</h1>
          <p className="mt-1 text-sm text-slate-500">Public sign-ups, contact details, verification state, and conversion follow-up.</p>
        </div>
        <div className="relative w-full lg:w-80">
          <UserRoundSearch className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setPage(1);
            }}
            placeholder="Search name, phone, email, company..."
            className="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm"
          />
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {LEAD_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setStatus(tab.id);
              setPage(1);
            }}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
              status === tab.id ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        {isLoading ? (
          <div className="p-10 text-center text-sm text-slate-500">Loading registrations...</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1050px] text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Registrant</th>
                    <th className="px-4 py-3">Phone</th>
                    <th className="px-4 py-3">Stage</th>
                    <th className="px-4 py-3">Verification</th>
                    <th className="px-4 py-3">License / Company</th>
                    <th className="px-4 py-3">Last activity</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data?.data?.length ? data.data.map((row) => (
                    <tr key={row.id} className="align-top hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{row.name}</div>
                        <a href={`mailto:${row.email}`} className="mt-0.5 inline-flex items-center gap-1 text-xs text-blue-700 hover:underline">
                          <Mail className="h-3 w-3" /> {row.email}
                        </a>
                        <div className="mt-1 text-xs text-slate-400">Registered {new Date(row.created_at).toLocaleDateString()}</div>
                      </td>
                      <td className="px-4 py-3">
                        {row.phone ? (
                          <a href={`tel:${row.phone}`} className="inline-flex items-center gap-1 text-slate-700 hover:text-blue-700">
                            <Phone className="h-3.5 w-3.5" /> {row.phone}
                          </a>
                        ) : <span className="text-slate-400">Not provided</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded border px-2 py-1 text-xs font-medium capitalize ${STAGE_STYLES[row.lead_status]}`}>
                          {row.lead_status}
                        </span>
                        {row.last_contacted_at && <div className="mt-1 text-xs text-slate-400">Contacted {new Date(row.last_contacted_at).toLocaleDateString()}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <div className={`inline-flex items-center gap-1 text-xs font-medium ${row.email_verified_at ? 'text-emerald-700' : 'text-amber-700'}`}>
                          {row.email_verified_at && <CheckCircle2 className="h-3.5 w-3.5" />}
                          {row.email_verified_at ? 'Email verified' : 'Awaiting verification'}
                        </div>
                        <div className={`mt-1 text-xs ${row.is_active ? 'text-slate-500' : 'text-red-600'}`}>
                          Portal {row.is_active ? 'active' : 'disabled'}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {row.license_id ? (
                          <Link to={`/superadmin/licenses/${row.license_id}`} className="font-medium capitalize text-violet-700 hover:underline">
                            {row.latest_license_status || 'License'}
                          </Link>
                        ) : <span className="text-slate-400">No license request</span>}
                        {row.company_id && (
                          <div>
                            <Link to={`/superadmin/companies/${row.company_id}`} className="text-xs text-blue-700 hover:underline">
                              {row.company_name || 'Open company'}
                            </Link>
                          </div>
                        )}
                        {row.license_count > 1 && <div className="text-xs text-slate-400">{row.license_count} total licenses</div>}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {row.last_login_at ? `Login ${new Date(row.last_login_at).toLocaleDateString()}` : 'Never logged in'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setEditing(row)}
                            className="rounded p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                            title="Edit lead"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteRow(row)}
                            disabled={remove.isPending || Boolean(row.company_id) || row.live_license_count > 0}
                            className="rounded p-2 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-300"
                            title={row.company_id || row.live_license_count > 0 ? 'Active customer records are protected' : 'Delete registration'}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-500">No registrations match these filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {data && data.pagination.totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm">
                <span className="text-slate-500">{data.pagination.total} registrations · Page {data.pagination.page} of {data.pagination.totalPages}</span>
                <div className="flex gap-2">
                  <button type="button" disabled={!data.pagination.hasPrev} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded border px-3 py-1.5 disabled:opacity-40">Previous</button>
                  <button type="button" disabled={!data.pagination.hasNext} onClick={() => setPage((value) => value + 1)} className="rounded border px-3 py-1.5 disabled:opacity-40">Next</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {editing && <LeadEditor row={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
