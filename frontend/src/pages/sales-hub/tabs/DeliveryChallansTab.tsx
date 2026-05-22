import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatDate } from '@/lib/formatters';
import { useCompany } from '@/hooks/useBusiness';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Download, Eye, Pencil, Plus, Trash2, Truck, UserPlus } from 'lucide-react';
import { QuickAddPartySheet } from '@/components/parties/QuickAddPartySheet';
import VyaparLineItems, { type VyaparLineItem } from '@/components/shared/VyaparLineItems';
import toast from 'react-hot-toast';

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-slate-100 text-slate-600',
  dispatched: 'bg-blue-100 text-blue-700',
  delivered: 'bg-emerald-100 text-emerald-700',
  converted: 'bg-violet-100 text-violet-700',
  cancelled: 'bg-red-100 text-red-600',
};

type FormMode = 'list' | 'create' | 'edit';

function todayIso() {
  return new Date().toISOString().split('T')[0];
}

function toLineItem(row: any): VyaparLineItem {
  return {
    item_id: row.item_id || undefined,
    name: row.item_name || row.name || 'Item',
    description: row.item_description || row.description || '',
    hsn_code: row.hsn_code || '',
    item_type: row.item_type,
    track_inventory: row.track_inventory,
    unit: row.unit || 'PCS',
    quantity: Number(row.quantity) || 1,
    unit_price: Math.max(0, Math.round(Number(row.unit_price) || 0)),
    discount_amount: Math.max(0, Math.round(Number(row.discount_amount) || 0)),
    gst_rate: 0,
    cess_rate: 0,
  };
}

export default function DeliveryChallansTab() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: company } = useCompany();
  const showChallanPricing = !!company?.delivery_challan_show_pricing;
  const [formMode, setFormMode] = useState<FormMode>('list');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [convertDialog, setConvertDialog] = useState<any>(null);
  const [invoiceDate, setInvoiceDate] = useState(todayIso());
  const [invoiceNumber, setInvoiceNumber] = useState('');

  const [partyId, setPartyId] = useState('');
  const [partyName, setPartyName] = useState('');
  const [partySearch, setPartySearch] = useState('');
  const [partyResults, setPartyResults] = useState<any[]>([]);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [challanDate, setChallanDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState('');
  const [transportName, setTransportName] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [lrNumber, setLrNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<VyaparLineItem[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['delivery-challans'],
    queryFn: () => api.get('/sales/challans', { params: { limit: 50 } }).then(r => r.data),
  });
  const challans = (data as any)?.data?.data || [];

  const resetForm = () => {
    setPartyId('');
    setPartyName('');
    setPartySearch('');
    setPartyResults([]);
    setNotes('');
    setTransportName('');
    setVehicleNumber('');
    setLrNumber('');
    setDueDate('');
    setItems([]);
    setChallanDate(todayIso());
    setEditingId(null);
  };

  const closeForm = () => {
    resetForm();
    setFormMode('list');
  };

  const startCreate = () => {
    resetForm();
    setFormMode('create');
  };

  const searchCustomers = async (q: string) => {
    setPartySearch(q);
    if (q.length < 2) { setPartyResults([]); return; }
    try {
      const { data: res } = await api.get('/parties/search', { params: { q } });
      setPartyResults(res.data || []);
    } catch {
      setPartyResults([]);
    }
  };

  const selectCustomer = (p: any) => {
    setPartyId(p.id);
    setPartyName(p.name);
    setPartySearch('');
    setPartyResults([]);
  };

  const clearCustomer = () => {
    setPartyId('');
    setPartyName('');
    setPartySearch('');
    setPartyResults([]);
  };

  const payloadFromForm = () => ({
    party_id: partyId,
    challan_date: challanDate,
    due_date: dueDate || undefined,
    transport_name: transportName.trim() || undefined,
    vehicle_number: vehicleNumber.trim() || undefined,
    lr_number: lrNumber.trim() || undefined,
    notes: notes.trim() || undefined,
    status: 'open',
    items: items.map(it => ({
      item_id: it.item_id,
      item_name: it.name,
      hsn_code: it.hsn_code,
      unit: it.unit,
      quantity: Number(it.quantity) || 0,
      unit_price: showChallanPricing ? Math.max(0, Math.round(Number(it.unit_price || 0))) : 0,
      gst_rate: 0,
      discount_amount: showChallanPricing ? Math.max(0, Math.round(Number(it.discount_amount || 0))) : 0,
    })),
  });

  const createMut = useMutation({
    mutationFn: (payload: any) => api.post('/sales/challans', payload),
    onSuccess: () => {
      toast.success('Delivery challan created');
      qc.invalidateQueries({ queryKey: ['delivery-challans'] });
      closeForm();
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to create challan'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) => api.patch(`/sales/challans/${id}`, payload),
    onSuccess: () => {
      toast.success('Delivery challan updated');
      qc.invalidateQueries({ queryKey: ['delivery-challans'] });
      closeForm();
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to update challan'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/sales/challans/${id}`),
    onSuccess: () => {
      toast.success('Delivery challan deleted');
      qc.invalidateQueries({ queryKey: ['delivery-challans'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to delete challan'),
  });

  const convertMut = useMutation({
    mutationFn: ({ id, ...payload }: any) => api.post(`/sales/challans/${id}/convert`, payload),
    onSuccess: (res) => {
      toast.success('Converted to invoice');
      qc.invalidateQueries({ queryKey: ['delivery-challans'] });
      qc.invalidateQueries({ queryKey: ['salesInvoices'] });
      const invoiceId = res.data?.data?.invoice_id;
      if (invoiceId) navigate(`/sales/${invoiceId}`);
      setConvertDialog(null);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Conversion failed'),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/sales/challans/${id}/status`, { status }),
    onSuccess: () => {
      toast.success('Status updated');
      qc.invalidateQueries({ queryKey: ['delivery-challans'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const startEdit = async (row: any) => {
    if (row.status === 'converted') {
      toast.error('Converted challans cannot be edited');
      return;
    }
    const t = toast.loading('Loading challan...');
    try {
      const res = await api.get(`/sales/challans/${row.id}`);
      const challan = res.data?.data;
      setEditingId(challan.id);
      setPartyId(challan.party_id || '');
      setPartyName(challan.party_name_snapshot || challan.party_name || '');
      setChallanDate(String(challan.challan_date || todayIso()).slice(0, 10));
      setDueDate(challan.due_date ? String(challan.due_date).slice(0, 10) : '');
      setTransportName(challan.transport_name || '');
      setVehicleNumber(challan.vehicle_number || '');
      setLrNumber(challan.lr_number || '');
      setNotes(challan.notes || '');
      setItems((challan.items || []).map(toLineItem));
      setFormMode('edit');
      toast.dismiss(t);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Could not load challan', { id: t });
    }
  };

  const saveForm = () => {
    if (!partyId) { toast.error('Select a party'); return; }
    if (!items.length) { toast.error('Add at least one item'); return; }
    const payload = payloadFromForm();
    if (formMode === 'edit' && editingId) updateMut.mutate({ id: editingId, payload });
    else createMut.mutate(payload);
  };

  const confirmDelete = (row: any) => {
    if (row.status === 'converted') {
      toast.error('Converted challans cannot be deleted');
      return;
    }
    if (window.confirm(`Delete delivery challan ${row.challan_number}?`)) {
      deleteMut.mutate(row.id);
    }
  };

  const openChallanPdf = async (id: string, challanNumber?: string, inline = false) => {
    const t = toast.loading(inline ? 'Opening challan...' : 'Preparing PDF...');
    try {
      const res = await api.get(`/sales/challans/${id}/pdf`, {
        params: inline ? { inline: 1 } : undefined,
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      if (inline) {
        window.open(url, '_blank', 'noopener,noreferrer');
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = `${challanNumber || 'delivery-challan'}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      }
      toast.success(inline ? 'Preview opened' : 'Download started', { id: t });
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Could not generate challan PDF', { id: t });
    }
  };

  if (formMode !== 'list') {
    return (
      <div className="space-y-5">
        <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              {formMode === 'edit' ? 'Edit Delivery Challan' : 'New Delivery Challan'}
            </h2>
            <p className="text-sm text-muted-foreground">
              Enter dispatch details and item movement in one full-width form.
            </p>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={closeForm}>Back</Button>
            <Button type="button" loading={createMut.isPending || updateMut.isPending} onClick={saveForm}>
              {formMode === 'edit' ? 'Update Challan' : 'Save Challan'}
            </Button>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-5 min-w-0">
            <section className="rounded-xl border bg-card p-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <Label className="text-xs">Party *</Label>
                  {partyId ? (
                    <div className="mt-1 flex items-center justify-between rounded-lg border bg-muted/30 p-2">
                      <span className="font-medium text-sm">{partyName || 'Selected party'}</span>
                      <button type="button" className="text-xs text-primary hover:underline" onClick={clearCustomer}>Change</button>
                    </div>
                  ) : (
                    <div className="mt-1 flex gap-2">
                      <div className="relative flex-1">
                        <Input placeholder="Search party..." value={partySearch} onChange={e => searchCustomers(e.target.value)} className="h-9" />
                        {partyResults.length > 0 && (
                          <div className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border bg-card shadow-lg">
                            {partyResults.map((p: any) => (
                              <button key={p.id} type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => selectCustomer(p)}>
                                {p.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setQuickAddOpen(true)}>
                        <UserPlus className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Challan Date</Label>
                    <Input type="date" className="mt-1 h-9" value={challanDate} onChange={e => setChallanDate(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">Due Date</Label>
                    <Input type="date" className="mt-1 h-9" value={dueDate} onChange={e => setDueDate(e.target.value)} />
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-xl border bg-card p-4">
              <div className="mb-3">
                <h3 className="text-sm font-semibold">Items</h3>
                <p className="text-xs text-muted-foreground">
                  {showChallanPricing
                    ? 'Pricing is plain reference pricing only. GST and tax are never added to delivery challans.'
                    : 'Pricing is disabled in company settings, so this challan will only show movement details.'}
                </p>
              </div>
              <VyaparLineItems
                items={items}
                onChange={(next) => setItems(next.map((it) => ({ ...it, gst_rate: 0, cess_rate: 0 })))}
                isGst={false}
                searchMode="catalog"
                showHsn
                showUnit
                showPricing={showChallanPricing}
              />
            </section>

            <section className="rounded-xl border bg-card p-4">
              <h3 className="mb-3 text-sm font-semibold">Transport & Notes</h3>
              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <Label className="text-xs">Transport / Courier</Label>
                  <Input className="mt-1 h-9" placeholder="e.g. DTDC, own vehicle" value={transportName} onChange={e => setTransportName(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Vehicle No.</Label>
                  <Input className="mt-1 h-9 uppercase font-mono" placeholder="MH12AB1234" value={vehicleNumber} onChange={e => setVehicleNumber(e.target.value.toUpperCase())} />
                </div>
                <div>
                  <Label className="text-xs">LR / Docket No.</Label>
                  <Input className="mt-1 h-9 font-mono" placeholder="Receipt number" value={lrNumber} onChange={e => setLrNumber(e.target.value)} />
                </div>
              </div>
              <div className="mt-3">
                <Label className="text-xs">Notes</Label>
                <textarea className="mt-1 w-full resize-y rounded-md border bg-transparent px-3 py-2 text-sm" rows={3} value={notes} onChange={e => setNotes(e.target.value)} />
              </div>
            </section>
          </div>

          <aside className="min-w-0 xl:sticky xl:top-[76px] xl:self-start">
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <h3 className="text-sm font-semibold">Summary</h3>
              <div className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Party</span><span className="max-w-[160px] truncate font-medium">{partyName || 'Not selected'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Items</span><span className="font-medium">{items.length}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Pricing</span><span className="font-medium">{showChallanPricing ? 'Enabled' : 'Hidden'}</span></div>
              </div>
              <div className="mt-4 flex flex-col gap-2">
                <Button loading={createMut.isPending || updateMut.isPending} onClick={saveForm}>
                  {formMode === 'edit' ? 'Update Challan' : 'Save Challan'}
                </Button>
                <Button variant="outline" onClick={closeForm}>Cancel</Button>
              </div>
            </div>
          </aside>
        </div>
        <QuickAddPartySheet open={quickAddOpen} onOpenChange={setQuickAddOpen} defaultName="" onCreated={(row) => selectCustomer(row)} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Track goods dispatched. Convert to invoice when payment is due.</p>
        <Button size="sm" className="gap-1.5" onClick={startCreate}>
          <Plus className="h-4 w-4" /> Add Delivery Challan
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Date</th>
              <th className="hidden px-4 py-2.5 text-left text-xs font-medium text-muted-foreground md:table-cell">Challan No.</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Party</th>
              <th className="hidden px-4 py-2.5 text-left text-xs font-medium text-muted-foreground lg:table-cell">Due Date</th>
              <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Status</th>
              <th className="w-72 px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} className="p-10 text-center text-muted-foreground">Loading...</td></tr>}
            {!isLoading && challans.length === 0 && (
              <tr><td colSpan={6} className="p-10 text-center text-muted-foreground">
                <Truck className="mx-auto mb-2 h-10 w-10 opacity-30" />No delivery challans yet.
              </td></tr>
            )}
            {challans.map((c: any) => {
              const canModify = c.status !== 'converted';
              return (
                <tr key={c.id} className="border-b hover:bg-muted/20">
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{formatDate(c.challan_date)}</td>
                  <td className="hidden px-4 py-2.5 font-mono text-xs md:table-cell">{c.challan_number}</td>
                  <td className="px-4 py-2.5 font-medium">{c.party_name_snapshot || c.party_name || '-'}</td>
                  <td className="hidden px-4 py-2.5 text-xs text-muted-foreground lg:table-cell">
                    {c.due_date ? formatDate(c.due_date) : '-'}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`rounded px-2 py-0.5 text-[11px] font-medium capitalize ${STATUS_COLORS[c.status] || 'bg-slate-100 text-slate-500'}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="flex justify-end gap-1.5 px-4 py-2.5 text-right">
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Preview" onClick={() => openChallanPdf(c.id, c.challan_number, true)}>
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Download" onClick={() => openChallanPdf(c.id, c.challan_number)}>
                      <Download className="h-4 w-4" />
                    </Button>
                    {canModify && (
                      <>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Edit" onClick={() => startEdit(c)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" title="Delete" onClick={() => confirmDelete(c)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                    {c.status === 'open' && (
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => statusMut.mutate({ id: c.id, status: 'dispatched' })}>
                        Dispatch
                      </Button>
                    )}
                    {canModify && (
                      <Button size="sm" className="h-7 bg-emerald-600 px-3 text-xs hover:bg-emerald-700" onClick={() => { setConvertDialog(c); setInvoiceDate(todayIso()); setInvoiceNumber(''); }}>
                        Convert
                      </Button>
                    )}
                    {c.status === 'converted' && c.invoice_id && (
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => navigate(`/sales/${c.invoice_id}`)}>
                        View Invoice
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {convertDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm space-y-4 rounded-xl bg-card p-6 shadow-2xl">
            <h3 className="text-lg font-bold">Convert to Sale Invoice</h3>
            <p className="text-sm text-muted-foreground">
              Challan <span className="font-mono font-medium">{convertDialog.challan_number}</span> · {convertDialog.party_name_snapshot}
            </p>
            <div>
              <Label className="text-xs">Invoice Date</Label>
              <Input type="date" className="mt-1 h-9" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Invoice No. (optional)</Label>
              <Input className="mt-1 h-9 font-mono text-xs" placeholder="Auto-generated" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} />
            </div>
            <div className="flex gap-3 border-t pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setConvertDialog(null)}>Cancel</Button>
              <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" loading={convertMut.isPending}
                onClick={() => convertMut.mutate({ id: convertDialog.id, invoice_date: invoiceDate, invoice_number: invoiceNumber || undefined })}>
                Confirm
              </Button>
            </div>
          </div>
        </div>
      )}

      <QuickAddPartySheet open={quickAddOpen} onOpenChange={setQuickAddOpen} defaultName="" onCreated={(row) => selectCustomer(row)} />
    </div>
  );
}
