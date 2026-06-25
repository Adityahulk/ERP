import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchSuperAdminCompanies } from '@/lib/superAdminApi';

export default function SuperAdminCompanies() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  const queryKey = useMemo(() => ['superadmin', 'companies', q, page] as const, [q, page]);

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchSuperAdminCompanies({ q: q.trim() || undefined, page, limit: 25 }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Companies</h1>
          <p className="text-slate-500 text-sm mt-1">All tenant companies and license linkage.</p>
        </div>
        <input
          placeholder="Search name, email, GSTIN…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          className="max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
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
                    <th className="px-4 py-3">Company</th>
                    <th className="px-4 py-3">Plan</th>
                    <th className="px-4 py-3">Users</th>
                    <th className="px-4 py-3">License</th>
                    <th className="px-4 py-3">Active</th>
                    <th className="px-4 py-3">Activated</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data?.data?.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{row.name}</div>
                        <div className="text-xs text-slate-500">{row.email || '—'}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{row.tier_display_name || row.plan_type || '—'}</td>
                      <td className="px-4 py-3">{row.user_count}</td>
                      <td className="px-4 py-3">
                        <span className="capitalize text-xs font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                          {row.license_status || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={row.is_active ? 'text-emerald-600' : 'text-red-600'}>{row.is_active ? 'Yes' : 'No'}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                        {row.activated_at ? new Date(row.activated_at).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link to={`/superadmin/companies/${row.id}`} className="text-violet-600 font-medium hover:underline">
                          View
                        </Link>
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
    </div>
  );
}
