import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ArrowLeft, Plus, X, Wrench, ArrowUpRight, ArrowDownLeft, ScanLine } from 'lucide-react';
import { QuickAddPartySheet } from '@/components/parties/QuickAddPartySheet';
import OcrBillSheet, { type OcrResult } from '@/components/shared/OcrBillSheet';
import MoneyInput from '@/components/transactions/MoneyInput';
import { TransactionHeader, TransactionPageShell } from '@/components/transactions/TransactionLayout';
import DocumentActionsBar from '@/components/transactions/DocumentActionsBar';
import { useTransactionDraft } from '@/hooks/useTransactionDraft';
import api from '@/lib/api';
import { LEGACY_STORAGE_KEYS, STORAGE_KEYS } from '@/lib/storageKeys';
import toast from 'react-hot-toast';

export default function JobWorkChallanForm() {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const [form, setForm] = useState<any>({
    challan_type: 'outward', party_id: '', godown_id: '',
    challan_date: new Date().toISOString().split('T')[0],
    is_capital_goods: false, transport_details: '', vehicle_number: '',
    labour_charges: 0, other_charges: 0, notes: '', service_only: false,
  });
  const [items, setItems] = useState<any[]>([]);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [ocrOpen, setOcrOpen] = useState(false);

  const { data: partiesData } = useQuery({
    queryKey: ['parties-jw'],
    queryFn: () => api.get('/parties/search', { params: { q: '' } }).then(r => r.data?.data ?? r.data),
  });
  const parties = partiesData ?? [];
  const selectParty = (party: Record<string, unknown>) => {
    const id = String(party.id || '');
    if (!id) return;
    setForm((prev: any) => ({ ...prev, party_id: id }));
    qc.invalidateQueries({ queryKey: ['parties-jw'] });
  };

  const { data: allItemsData } = useQuery({
    queryKey: ['items-jw'],
    queryFn: () => api.get('/items', { params: { page: 1, limit: 500, is_active: 'true' } }).then(r => r.data?.data ?? r.data),
  });
  const allItems = allItemsData?.data ?? [];

  const { data: godownsData } = useQuery({
    queryKey: ['godowns-jw'],
    queryFn: () => api.get('/godowns').then(r => r.data?.data ?? r.data),
  });
  const godowns = (godownsData as any) ?? [];

  const { clearDraft, saveDraft, loadDraft, hasDraft } = useTransactionDraft(
    STORAGE_KEYS.drafts.jobWorkChallan,
    { form, items },
    (draft: any) => {
      if (draft.form && typeof draft.form === 'object') {
        setForm((prev: any) => ({ ...prev, ...draft.form }));
      }
      setItems(Array.isArray(draft.items) ? draft.items : []);
    },
    {
      legacyKey: LEGACY_STORAGE_KEYS.drafts.jobWorkChallan,
      shouldSave: (draft) => Boolean(
        draft.form?.party_id || draft.form?.godown_id || draft.form?.transport_details ||
        draft.form?.vehicle_number || draft.form?.notes || draft.form?.service_only ||
        Number(draft.form?.labour_charges || 0) > 0 || Number(draft.form?.other_charges || 0) > 0 ||
        draft.items.length
      ),
    },
  );

  const saveCurrentDraft = () => {
    if (saveDraft()) toast.success('Draft saved');
    else toast.error('Add challan details before saving a draft');
  };

  const loadSavedDraft = () => {
    if (loadDraft()) toast.success('Draft loaded');
    else toast.error('No saved draft found');
  };

  const clearSavedDraft = () => {
    clearDraft();
    toast.success('Draft cleared');
  };

  const handleOcrConfirm = (data: OcrResult & { overrides: any }) => {
    if (data.bill_date) {
      setForm((prev: any) => ({ ...prev, challan_date: data.bill_date }));
    }
    if (data.items && data.items.length > 0) {
      const mapped = data.items.map((item) => {
        const rate = item.rate_paise != null
          ? Number(item.rate_paise)
          : (item.amount_paise != null && item.quantity ? Math.round(Number(item.amount_paise) / Number(item.quantity)) : Number(item.amount_paise || 0));
        
        const matchedItem = allItems.find((it: any) =>
          it.name.toLowerCase() === item.description.toLowerCase() ||
          (it.hsn_code && item.hsn_code && it.hsn_code === item.hsn_code)
        );

        return {
          item_id: matchedItem ? matchedItem.id : '',
          item_name: matchedItem ? matchedItem.name : String(item.description || ''),
          hsn_code: matchedItem ? (matchedItem.hsn_code || '') : (item.hsn_code ? String(item.hsn_code) : ''),
          unit: matchedItem ? (matchedItem.unit || matchedItem.unit_abbr || 'PCS') : String(item.unit || 'PCS'),
          quantity: Number(item.quantity) || 1,
          unit_price: rate,
        };
      });
      setItems((prev) => {
        const isEmpty = prev.length === 0 || (prev.length === 1 && !prev[0].item_id && !prev[0].unit_price);
        return isEmpty ? mapped : [...prev, ...mapped];
      });
      toast.success(`Imported ${data.items.length} item(s) from scan`);
    }
    if (data.matched_party_id && data.matched_party) {
      selectParty(data.matched_party);
      toast.success('Matched job worker from OCR and applied it');
    } else if (data.party_name) {
      toast(`Party name from scan: "${data.party_name}" — please select manually`, { icon: 'ℹ️' });
    }
  };

  useEffect(() => {
    if (location.state?.ocrData) {
      handleOcrConfirm(location.state.ocrData);
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  const saveMutation = useMutation({
    mutationFn: (data: any) => api.post('/job-work/challans', data),
    onSuccess: (res) => { toast.success('Challan created'); clearDraft(); qc.invalidateQueries({ queryKey: ['jw-challans'] }); navigate(`/job-work/${res.data?.data?.id || ''}`); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const addItem = () => setItems([...items, { item_id: '', item_name: '', quantity: 1, unit_price: 0, unit: 'PCS', hsn_code: '' }]);
  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i));
  const updateItem = (i: number, field: string, value: any) => {
    const u = [...items]; u[i] = { ...u[i], [field]: value };
    if (field === 'item_id') {
      const item = allItems.find((it: any) => it.id === value);
      if (item) { u[i].item_name = item.name; u[i].unit_price = item.purchase_price || 0; u[i].hsn_code = item.hsn_code || ''; }
    }
    setItems(u);
  };

  const totalMaterialValue = items.reduce((s, i) => s + (i.unit_price || 0) * (i.quantity || 0), 0);
  const fmtAmt = (v: number) => `₹${((v || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  const isServiceOnly = !!form.service_only;
  const hasServiceDetails = Boolean(
    Number(form.labour_charges || 0) > 0 ||
    Number(form.other_charges || 0) > 0 ||
    String(form.notes || '').trim()
  );
  const hasValidMaterialRows = items.length > 0 && items.every(i => i.item_id);
  const canSave = !!form.party_id && (hasValidMaterialRows || (isServiceOnly && hasServiceDetails));

  const handleSave = () => {
    if (!form.party_id) { toast.error('Select a job worker'); return; }
    if (isServiceOnly) {
      if (items.length && items.some(i => !i.item_id)) { toast.error('Select material for every material row'); return; }
      if (!items.length && !hasServiceDetails) { toast.error('Add service charges or notes for service-only job work'); return; }
    } else if (!items.length || items.some(i => !i.item_id)) {
      toast.error('Add materials or enable service-only job work');
      return;
    }
    saveMutation.mutate({
      ...form,
      labour_charges: Math.round((form.labour_charges || 0) * 100),
      other_charges: Math.round((form.other_charges || 0) * 100),
      items: items.map(i => ({
        item_id: i.item_id, item_name: i.item_name, hsn_code: i.hsn_code,
        unit: i.unit, unit_price: i.unit_price,
        [form.challan_type === 'outward' ? 'quantity_sent' : 'quantity_received']: i.quantity,
      })),
    });
  };

  return (
    <TransactionPageShell className="max-w-6xl">
      <TransactionHeader
        title="New Job Work Challan"
        description="Send materials to a job worker or record processed goods received back."
        left={<Button variant="ghost" size="icon" onClick={() => navigate('/job-work')}><ArrowLeft className="w-5 h-5" /></Button>}
        actions={(
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={saveCurrentDraft}>Save draft</Button>
            <Button type="button" variant="outline" size="sm" disabled={!hasDraft} onClick={loadSavedDraft}>Load draft</Button>
            {hasDraft && <Button type="button" variant="ghost" size="sm" onClick={clearSavedDraft}>Clear draft</Button>}
            <Button type="button" variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={() => setOcrOpen(true)}>
              <ScanLine className="w-4 h-4" /> Scan Challan
            </Button>
            <Wrench className="w-5 h-5 text-indigo-600" />
          </div>
        )}
      />

      {/* Challan Type */}
      <Card className="mb-6"><CardContent className="p-6">
        <Label className="mb-3 block">Challan Type</Label>
        <div className="flex gap-3">
          {[
            { value: 'outward', label: 'Outward (Send to Job Worker)', icon: ArrowUpRight, desc: 'Send raw materials for processing' },
            { value: 'inward', label: 'Inward (Receive from Job Worker)', icon: ArrowDownLeft, desc: 'Receive processed goods back' },
          ].map(t => (
            <button key={t.value} onClick={() => setForm({ ...form, challan_type: t.value })}
              className={`flex-1 p-4 rounded-lg border-2 text-left transition-all ${form.challan_type === t.value ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-slate-300'}`}>
              <div className="flex items-center gap-2 mb-1">
                <t.icon className={`w-4 h-4 ${form.challan_type === t.value ? 'text-indigo-600' : 'text-slate-400'}`} />
                <span className="font-bold text-sm">{t.label}</span>
              </div>
              <p className="text-xs text-slate-500">{t.desc}</p>
            </button>
          ))}
        </div>
      </CardContent></Card>

      {/* Details */}
      <Card className="mb-6"><CardContent className="p-6 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="col-span-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Job Worker / Party *</Label>
              <Button type="button" size="sm" variant="ghost" className="h-7 gap-1 text-indigo-600" onClick={() => setQuickAddOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Quick add
              </Button>
            </div>
            <div className="mt-1 flex gap-2">
              <select className="w-full h-9 rounded-md border bg-transparent px-3 text-sm" value={form.party_id} onChange={e => setForm({ ...form, party_id: e.target.value })}>
                <option value="">— Select —</option>
                {parties.map((p: any) => <option key={p.id} value={p.id}>{p.name} {p.gstin ? `(${p.gstin})` : ''}</option>)}
              </select>
            </div>
          </div>
          <div><Label>Date</Label><Input type="date" className="mt-1" value={form.challan_date} onChange={e => setForm({ ...form, challan_date: e.target.value })} /></div>
          <div><Label>Godown</Label>
            <select className="mt-1 w-full h-9 rounded-md border bg-transparent px-3 text-sm" value={form.godown_id} onChange={e => setForm({ ...form, godown_id: e.target.value })}>
              <option value="">— Select —</option>
              {godowns.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div><Label>Transport Details</Label><Input className="mt-1" value={form.transport_details} onChange={e => setForm({ ...form, transport_details: e.target.value })} /></div>
          <div><Label>Vehicle Number</Label><Input className="mt-1" value={form.vehicle_number} onChange={e => setForm({ ...form, vehicle_number: e.target.value })} /></div>
          <div><Label>Labour Charges (₹)</Label><MoneyInput className="mt-1" value={Math.round((form.labour_charges || 0) * 100)} onChange={paise => setForm({ ...form, labour_charges: paise / 100 })} /></div>
          <div><Label>Other Charges (₹)</Label><MoneyInput className="mt-1" value={Math.round((form.other_charges || 0) * 100)} onChange={paise => setForm({ ...form, other_charges: paise / 100 })} /></div>
        </div>
        <div className="flex items-center gap-3 p-3 rounded-lg border bg-indigo-50 border-indigo-100">
          <Switch checked={isServiceOnly} onCheckedChange={v => setForm({ ...form, service_only: v })} />
          <div>
            <p className="text-sm font-medium text-slate-900">Service-only job work</p>
            <p className="text-xs text-slate-500">Use this when no material is sent or received. Add labour/service charges or notes describing the service.</p>
          </div>
        </div>
        {form.challan_type === 'outward' && (
          <div className="flex items-center gap-3 p-3 rounded-lg border bg-amber-50 border-amber-200">
            <Switch checked={form.is_capital_goods} onCheckedChange={v => setForm({ ...form, is_capital_goods: v })} />
            <div><p className="text-sm font-medium">Capital Goods</p><p className="text-xs text-slate-500">Return deadline: {form.is_capital_goods ? '3 years' : '1 year'} (GST Section 143)</p></div>
          </div>
        )}
        <div><Label>Notes</Label><textarea className="mt-1 w-full border rounded-md p-3 text-sm h-16 resize-none" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
      </CardContent></Card>

      {/* Items */}
      <Card className="mb-6"><CardContent className="p-6">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Materials {isServiceOnly && <span className="text-xs font-medium text-slate-400">(optional)</span>}</h2>
            {isServiceOnly && <p className="text-xs text-slate-500">Leave empty for service-only work, or add materials if there is also material movement.</p>}
          </div>
          <Button variant="outline" size="sm" className="gap-1" onClick={addItem}><Plus className="w-3 h-3" /> Add Material</Button>
        </div>
        {items.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-6">
            {isServiceOnly
              ? 'No material movement will be recorded for this service job.'
              : `Add materials being ${form.challan_type === 'outward' ? 'sent out' : 'received back'}`}
          </p>
        )}
        <div className="space-y-3">
          {items.map((item, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end p-3 bg-slate-50 rounded-lg">
              <div className="col-span-4">{i === 0 && <Label className="text-xs">Material</Label>}
                <select className="w-full h-9 rounded-md border bg-white px-2 text-sm mt-1" value={item.item_id} onChange={e => updateItem(i, 'item_id', e.target.value)}>
                  <option value="">— Select —</option>
                  {allItems.map((it: any) => <option key={it.id} value={it.id}>{it.name}</option>)}
                </select>
              </div>
              <div className="col-span-2">{i === 0 && <Label className="text-xs">Quantity</Label>}<Input type="number" min={0.01} step={0.01} className="mt-1" value={item.quantity || ''} onChange={e => updateItem(i, 'quantity', parseFloat(e.target.value) || 0)} /></div>
              <div className="col-span-2">
                {i === 0 && <Label className="text-xs">Unit Price (₹)</Label>}
                <MoneyInput
                  className="mt-1 tabular-nums" 
                  value={item.unit_price || 0}
                  onChange={paise => updateItem(i, 'unit_price', paise)}
                />
              </div>
              <div className="col-span-2">{i === 0 && <Label className="text-xs">HSN/SAC</Label>}<Input className="mt-1" value={item.hsn_code || ''} onChange={e => updateItem(i, 'hsn_code', e.target.value)} /></div>
              <div className="col-span-1">{i === 0 && <Label className="text-xs">Total (₹)</Label>}<p className="text-sm font-bold mt-2 text-right">{( (item.unit_price || 0) * (item.quantity || 0) / 100).toFixed(2)}</p></div>
              <div className="col-span-1 flex justify-end"><Button variant="ghost" size="icon" className="text-red-400" onClick={() => removeItem(i)}><X className="w-4 h-4" /></Button></div>
            </div>
          ))}
        </div>

        {(items.length > 0 || isServiceOnly) && (
          <div className="mt-6 space-y-2 border-t pt-4">
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-500">Total Material Value (Not taxed on challan)</span>
              <span className="font-bold">{fmtAmt(totalMaterialValue)}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-500">Labour & Service Charges</span>
              <span className="font-bold">{fmtAmt(Math.round((form.labour_charges + form.other_charges) * 100))}</span>
            </div>
            <p className="text-[10px] text-slate-400 text-right italic">
              * Unit prices are used for insurance/declaration value on the challan. 
              Actual billing (GST) is usually done via a separate Service Invoice or Bill.
            </p>
          </div>
        )}
      </CardContent></Card>

      <div className="sticky bottom-0 z-20 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur">
        <DocumentActionsBar
          onCancel={() => navigate('/job-work')}
          onSave={handleSave}
          canSave={canSave}
          saving={saveMutation.isPending}
          saveLabel="Create Challan"
        />
      </div>
      <QuickAddPartySheet open={quickAddOpen} onOpenChange={setQuickAddOpen} defaultName="" onCreated={selectParty} />
      <OcrBillSheet
        open={ocrOpen}
        onOpenChange={setOcrOpen}
        context="Delivery Challan"
        onConfirm={handleOcrConfirm}
      />
    </TransactionPageShell>
  );
}
