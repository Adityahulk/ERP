import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useParties, useCreateParty, useDeleteParty } from '@/hooks/useBusiness';
import { formatMoney } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { Search, Users, Truck, UserPlus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';

export default function PartyList() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<any>({ page: 1, limit: 25 });
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);

  const activeFilters = { ...filters, search: search || undefined, party_type: typeFilter || undefined };
  const { data, isLoading } = useParties(activeFilters);
  const createMutation = useCreateParty();
  const deleteMutation = useDeleteParty();

  const parties = data?.data?.data || [];
  const pagination = data?.data?.pagination;
  const meta = data?.meta || {};

  const [form, setForm] = useState<any>({ party_type: 'customer' });
  const u = (f: string, v: any) => setForm((p: any) => ({ ...p, [f]: v }));

  const handleCreate = async () => {
    if (!form.name?.trim()) { toast.error('Name is required'); return; }
    try {
      await createMutation.mutateAsync(form);
      toast.success('Party created');
      setShowForm(false);
      setForm({ party_type: 'customer' });
    } catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const runDeleteParty = async () => {
    if (!pendingDelete) return;
    try {
      await deleteMutation.mutateAsync(pendingDelete.id);
      toast.success('Deleted');
      setPendingDelete(null);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed');
    }
  };

  const stats = [
    { label: 'Customers', value: meta.total_customers || 0, icon: Users, color: 'text-blue-600 bg-blue-50 dark:bg-blue-500/10' },
    { label: 'Suppliers', value: meta.total_suppliers || 0, icon: Truck, color: 'text-purple-600 bg-purple-50 dark:bg-purple-500/10' },
    { label: 'Receivable', value: formatMoney(parseInt(meta.total_receivable) || 0), icon: Users, color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10' },
    { label: 'Payable', value: formatMoney(parseInt(meta.total_payable) || 0), icon: Truck, color: 'text-red-600 bg-red-50 dark:bg-red-500/10' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold">Parties</h1><p className="text-muted-foreground text-sm">Customers & Suppliers</p></div>
        <Button size="sm" onClick={() => setShowForm(true)}><UserPlus className="w-4 h-4 mr-1" />Add Party</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map(s => (
          <Card key={s.label}><CardContent className="p-4 flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${s.color}`}><s.icon className="w-4 h-4" /></div>
            <div><p className="text-xs text-muted-foreground">{s.label}</p><p className="text-lg font-bold tabular-nums">{s.value}</p></div>
          </CardContent></Card>
        ))}
      </div>

      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search by name, phone, GSTIN..." className="pl-9" value={search} onChange={e => { setSearch(e.target.value); setFilters((f: any) => ({ ...f, page: 1 })); }} />
        </div>
        {['', 'customer', 'supplier', 'both'].map(t => (
          <button key={t} onClick={() => { setTypeFilter(t); setFilters((f: any) => ({ ...f, page: 1 })); }} className={`px-3 py-1.5 rounded-md text-xs font-medium ${typeFilter === t ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
            {t === '' ? 'All' : t === 'both' ? 'Both' : t === 'customer' ? '👤 Customers' : '🚚 Suppliers'}
          </button>
        ))}
      </div>

      <div className="border rounded-xl bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b bg-muted/40">
            <th className="p-3 text-left font-medium">Name</th>
            <th className="p-3 text-left font-medium hidden md:table-cell">Phone</th>
            <th className="p-3 text-left font-medium hidden lg:table-cell">GSTIN</th>
            <th className="p-3 text-center font-medium">Type</th>
            <th className="p-3 text-right font-medium">Balance</th>
            <th className="p-3 text-right font-medium hidden md:table-cell">Business</th>
            <th className="w-16 p-3"></th>
          </tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className="p-12 text-center text-muted-foreground">Loading...</td></tr>}
            {!isLoading && parties.length === 0 && <tr><td colSpan={7} className="p-12 text-center text-muted-foreground"><Users className="w-12 h-12 mx-auto mb-3 opacity-30" />No parties found</td></tr>}
            {parties.map((p: any) => (
              <tr key={p.id} className="border-b hover:bg-muted/30 cursor-pointer" onClick={() => navigate(`/parties/${p.id}`)}>
                <td className="p-3"><div className="font-medium">{p.name}</div>{p.city && <div className="text-xs text-muted-foreground">{p.city}{p.state ? `, ${p.state}` : ''}</div>}</td>
                <td className="p-3 hidden md:table-cell text-muted-foreground">{p.phone || '—'}</td>
                <td className="p-3 hidden lg:table-cell font-mono text-xs text-muted-foreground">{p.gstin || '—'}</td>
                <td className="p-3 text-center"><Badge variant={p.party_type === 'customer' ? 'info' : p.party_type === 'supplier' ? 'secondary' : 'outline'} className="capitalize text-[10px]">{p.party_type}</Badge></td>
                <td className={`p-3 text-right tabular-nums font-semibold ${p.balance > 0 ? 'text-emerald-600' : p.balance < 0 ? 'text-red-500' : ''}`}>{p.balance !== 0 ? formatMoney(Math.abs(p.balance)) : '—'}{p.balance > 0 && <span className="text-[9px] block text-muted-foreground">receivable</span>}{p.balance < 0 && <span className="text-[9px] block text-muted-foreground">payable</span>}</td>
                <td className="p-3 text-right tabular-nums hidden md:table-cell text-muted-foreground">{formatMoney(parseInt(p.total_business) || 0)}</td>
                <td className="p-3" onClick={e => e.stopPropagation()}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:bg-destructive/10 h-8 w-8"
                    title="Delete party"
                    loading={deleteMutation.isPending && pendingDelete?.id === p.id}
                    onClick={() => setPendingDelete({ id: p.id, name: p.name })}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between p-4 border-t">
            <span className="text-sm text-muted-foreground">Page {pagination.page} of {pagination.totalPages}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={!pagination.hasPrev} onClick={() => setFilters((f: any) => ({ ...f, page: f.page - 1 }))}>Previous</Button>
              <Button size="sm" variant="outline" disabled={!pagination.hasNext} onClick={() => setFilters((f: any) => ({ ...f, page: f.page + 1 }))}>Next</Button>
            </div>
          </div>
        )}
      </div>

      {/* Create Party Sheet */}
      <Sheet open={showForm} onOpenChange={setShowForm}>
        <SheetContent side="right" className="overflow-y-auto">
          <SheetHeader className="mb-6"><SheetTitle>New Party</SheetTitle></SheetHeader>
          <div className="space-y-4">
            <div><Label>Party Type</Label><div className="flex gap-2 mt-1">
              {['customer','supplier','both'].map(t => (<button key={t} onClick={() => u('party_type', t)} className={`flex-1 py-2 rounded-lg text-xs font-medium capitalize ${form.party_type === t ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{t}</button>))}
            </div></div>
            <div><Label>Name *</Label><Input className="mt-1" value={form.name || ''} onChange={e => u('name', e.target.value)} autoFocus /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Phone</Label><Input className="mt-1" value={form.phone || ''} onChange={e => u('phone', e.target.value)} /></div>
              <div><Label>Email</Label><Input className="mt-1" type="email" value={form.email || ''} onChange={e => u('email', e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>GSTIN</Label><Input className="mt-1 uppercase font-mono" maxLength={15} value={form.gstin || ''} onChange={e => u('gstin', e.target.value.toUpperCase())} /></div>
              <div><Label>PAN</Label><Input className="mt-1 uppercase font-mono" maxLength={10} value={form.pan || ''} onChange={e => u('pan', e.target.value.toUpperCase())} /></div>
            </div>
            <div><Label>Billing Address</Label><textarea rows={2} className="mt-1 w-full rounded-md border px-3 py-2 text-sm bg-transparent resize-none" value={form.billing_address || ''} onChange={e => u('billing_address', e.target.value)} /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>City</Label><Input className="mt-1" value={form.city || ''} onChange={e => u('city', e.target.value)} /></div>
              <div><Label>State</Label><Input className="mt-1" value={form.state || ''} onChange={e => u('state', e.target.value)} /></div>
              <div><Label>Pincode</Label><Input className="mt-1" maxLength={6} value={form.pincode || ''} onChange={e => u('pincode', e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Credit Limit (₹)</Label><Input className="mt-1" type="number" min={0} value={form.credit_limit || ''} onChange={e => u('credit_limit', parseInt(e.target.value) || 0)} /></div>
              <div><Label>Payment Terms (days)</Label><Input className="mt-1" type="number" min={0} value={form.payment_terms || 30} onChange={e => u('payment_terms', parseInt(e.target.value) || 0)} /></div>
            </div>
            <div><Label>Opening Balance (₹) <span className="text-muted-foreground text-[10px]">(+ve = receivable, -ve = payable)</span></Label><Input className="mt-1" type="number" value={form.opening_balance || ''} onChange={e => u('opening_balance', parseInt(e.target.value) || 0)} /></div>
            <div className="flex gap-3 mt-6 pt-4 border-t">
              <Button variant="outline" className="flex-1" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button className="flex-1" loading={createMutation.isPending} onClick={handleCreate}>
                Save Party
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Delete party?"
        description={
          pendingDelete
            ? `Remove “${pendingDelete.name}” from customers/suppliers. Invoices referencing this party may block deletion.`
            : ''
        }
        confirmLabel="Delete"
        variant="destructive"
        isPending={deleteMutation.isPending}
        onConfirm={runDeleteParty}
      />
    </div>
  );
}
