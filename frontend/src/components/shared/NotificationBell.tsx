import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, AlertTriangle, PackageX, RefreshCw, X } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

type Alerts = {
  overdueCount: number;
  lowStockCount: number;
  overdueInvoices: { id: string; invoice_number: string; due_date: string }[];
  lowStockItems: { id: string; name: string; quantity: string; reorder_point: string }[];
};

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const companyId = useAuthStore((state) => state.user?.companyId);
  const { data, isLoading, isError, isFetching, refetch } = useQuery<Alerts>({
    queryKey: ['in-app-alerts', companyId],
    queryFn: async () => (await api.get('/notifications/in-app')).data.data,
    enabled: !!companyId,
    staleTime: 60_000,
    refetchInterval: 300_000,
    refetchOnWindowFocus: true,
  });
  const count = (data?.overdueCount ?? 0) + (data?.lowStockCount ?? 0);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative shrink-0 text-slate-500"
          aria-label={count ? `Notifications, ${count} alerts` : 'Notifications'}
          title="Notifications"
        >
          <Bell className="h-5 w-5" />
          {count > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" aria-hidden="true" />}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 w-[min(24rem,calc(100vw-1rem))] rounded-md border border-slate-200 bg-white shadow-xl outline-none"
        >
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Notifications</h2>
            <div className="flex items-center gap-1">
              <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => refetch()} title="Refresh alerts" aria-label="Refresh alerts" disabled={isFetching}>
                <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
              </Button>
              <Popover.Close asChild>
                <Button type="button" size="icon" variant="ghost" className="h-7 w-7" title="Close notifications" aria-label="Close notifications"><X className="h-4 w-4" /></Button>
              </Popover.Close>
            </div>
          </div>
          <div className="max-h-[min(65vh,26rem)] overflow-y-auto">
            {isLoading && <p className="px-4 py-6 text-center text-sm text-slate-500">Loading alerts…</p>}
            {isError && <p role="alert" className="px-4 py-6 text-center text-sm text-red-700">Could not load notifications. Try refreshing.</p>}
            {!isLoading && !isError && count === 0 && <p className="px-4 py-6 text-center text-sm text-slate-500">No alerts right now.</p>}
            {!isLoading && !isError && data && data.overdueCount > 0 && (
              <section className="border-b border-slate-100 py-2" aria-label="Overdue invoices">
                <div className="flex items-center justify-between px-4 py-1 text-xs font-semibold text-slate-600">
                  <span>Overdue invoices ({data.overdueCount})</span>
                  <Popover.Close asChild><Link to="/sales-hub/invoices" className="text-blue-700 hover:underline">View all</Link></Popover.Close>
                </div>
                {data.overdueInvoices.map((invoice) => (
                  <Popover.Close asChild key={invoice.id}>
                    <Link to={`/sales/${invoice.id}`} className="flex items-start gap-3 px-4 py-2 text-sm text-slate-800 hover:bg-slate-50">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                      <span className="min-w-0"><span className="block truncate font-medium">{invoice.invoice_number}</span><span className="block text-xs text-slate-500">Due {invoice.due_date.slice(0, 10)}</span></span>
                    </Link>
                  </Popover.Close>
                ))}
              </section>
            )}
            {!isLoading && !isError && data && data.lowStockCount > 0 && (
              <section className="py-2" aria-label="Low stock items">
                <div className="flex items-center justify-between px-4 py-1 text-xs font-semibold text-slate-600">
                  <span>Low stock ({data.lowStockCount})</span>
                  <Popover.Close asChild><Link to="/inventory" className="text-blue-700 hover:underline">View all</Link></Popover.Close>
                </div>
                {data.lowStockItems.map((item) => (
                  <Popover.Close asChild key={item.id}>
                    <Link to={`/items/${item.id}`} className="flex items-start gap-3 px-4 py-2 text-sm text-slate-800 hover:bg-slate-50">
                      <PackageX className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                      <span className="min-w-0"><span className="block truncate font-medium">{item.name}</span><span className="block text-xs text-slate-500">{item.quantity} in stock · reorder at {item.reorder_point}</span></span>
                    </Link>
                  </Popover.Close>
                ))}
              </section>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
