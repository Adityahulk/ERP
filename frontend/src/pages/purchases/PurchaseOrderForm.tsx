import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useGodowns } from '@/hooks/useStock';
import toast from 'react-hot-toast';
import { ArrowLeft, ScanLine, UserPlus } from 'lucide-react';
import { QuickAddPartySheet } from '@/components/parties/QuickAddPartySheet';
import OcrBillSheet, { type OcrResult } from '@/components/shared/OcrBillSheet';
import VyaparLineItems, { type VyaparLineItem } from '@/components/shared/VyaparLineItems';

export default function PurchaseOrderForm() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: godownRes } = useGodowns();
  const godowns = (godownRes as any)?.data ?? [];

  // Supplier
  const [partyId, setPartyId] = useState('');
  const [partyName, setPartyName] = useState('');
  const [partySearch, setPartySearch] = useState('');
  const [partyResults, setPartyResults] = useState<any[]>([]);
  const [partySearchLoading, setPartySearchLoading] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddDefaultName, setQuickAddDefaultName] = useState('');

  // Doc info
  const [godownId, setGodownId] = useState('');
  const [expectedDate, setExpectedDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().split('T')[0];
  });
  const [notes, setNotes] = useState('');

  // Line items
  const [items, setItems] = useState<VyaparLineItem[]>([]);

  // Misc
  const [ocrOpen, setOcrOpen] = useState(false);

  const defaultGodown = useMemo(() => {
    const def = godowns.find((g: any) => g.is_default);
    return def?.id ?? godowns[0]?.id ?? '';
  }, [godowns]);

  useEffect(() => {
    if (!godownId && defaultGodown) setGodownId(defaultGodown);
  }, [godownId, defaultGodown]);

  const searchSuppliers = async (q: string) => {
    setPartySearch(q);
    if (q.length < 2) { setPartyResults([]); setPartySearchLoading(false); return; }
    setPartySearchLoading(true);
    try {
      const { data: res } = await api.get('/parties/search', { params: { q } });
      setPartyResults(res.data || []);
    } catch { setPartyResults([]); }
    finally { setPartySearchLoading(false); }
  };

  const selectSupplier = (p: any) => {
    setPartyId(p.id); setPartyName(p.name);
    setPartySearch(''); setPartyResults([]);
  };

  const clearSupplier = () => {
    setPartyId(''); setPartyName('');
    setPartySearch(''); setPartyResults([]);
  };

  const handleOcrConfirm = (data: OcrResult & { overrides: any }) => {
    if (data.bill_date) setExpectedDate(data.bill_date);
    if (data.party_name) {
      setPartySearch(data.party_name);
      searchSuppliers(data.party_name);
      toast('Party name applied — search & select or add new', { icon: 'ℹ️' });
    }
  };

  const createPO = useMutation({
    mutationFn: async () => {
      return api.post('/purchases/orders', {
        party_id: partyId,
        godown_id: godownId,
        po_date: new Date().toISOString().split('T')[0],
        expected_date: expectedDate,
        notes: notes.trim() || undefined,
        items: items.map((item) => ({
          item_id: item.item_id,
          item_name: item.name,
          hsn_code: item.hsn_code || undefined,
          quantity: item.quantity,
          unit_price: item.unit_price,
          gst_rate: item.gst_rate,
        })),
      });
    },
    onSuccess: () => {
      toast.success('Purchase order created');
      qc.invalidateQueries({ queryKey: ['purchases'] });
      navigate('/purchases');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || e.message || 'Failed to create PO'),
  });

  const canSave = !!partyId && !!godownId && items.length > 0;

  return (
    <div className="max-w-4xl mx-auto space-y-5 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/purchases')}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">New Purchase Order</h1>
            <p className="text-sm text-muted-foreground">Select party and add items to order</p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={() => setOcrOpen(true)}>
          <ScanLine className="w-4 h-4" />
          Scan Supplier Quote
        </Button>
      </div>

      {/* Supplier + Doc Info */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Supplier */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Party</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {partyId ? (
              <div className="flex items-center justify-between p-2.5 rounded-lg border bg-muted/30">
                <span className="font-medium text-sm">{partyName}</span>
                <button type="button" className="text-xs text-primary hover:underline" onClick={clearSupplier}>Change</button>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      placeholder="Search party by name, GSTIN…"
                      value={partySearch}
                      onChange={(e) => searchSuppliers(e.target.value)}
                    />
                    {partyResults.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-card border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                        {partyResults.map((p: any) => (
                          <button key={p.id} type="button" className="w-full text-left px-3 py-2 hover:bg-muted text-sm" onClick={() => selectSupplier(p)}>
                            <span className="font-medium">{p.name}</span>
                            {p.gstin && <span className="text-muted-foreground ml-2 font-mono text-xs">{p.gstin}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button type="button" variant="outline" size="sm" className="gap-1 shrink-0" onClick={() => { setQuickAddDefaultName(partySearch.trim()); setQuickAddOpen(true); }}>
                    <UserPlus className="h-4 w-4" />
                  </Button>
                </div>
                {partySearch.length >= 2 && !partySearchLoading && partyResults.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Not found.{' '}
                    <button type="button" className="text-primary font-medium hover:underline" onClick={() => { setQuickAddDefaultName(partySearch.trim()); setQuickAddOpen(true); }}>
                      Add "{partySearch.trim()}" as party
                    </button>
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* PO Info */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Order Details</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Expected Date</Label>
                <Input type="date" className="mt-1 h-9" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Receive into Godown</Label>
                <select className="mt-1 w-full h-9 rounded-md border bg-background px-3 text-sm" value={godownId} onChange={(e) => setGodownId(e.target.value)}>
                  <option value="">Select godown</option>
                  {godowns.map((g: any) => (
                    <option key={g.id} value={g.id}>{g.name}{g.is_default ? ' (default)' : ''}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Notes (optional)</Label>
              <textarea
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm bg-transparent resize-none"
                rows={2}
                placeholder="Delivery instructions, special requirements…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Line Items */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Items to Order</CardTitle>
        </CardHeader>
        <CardContent>
          <VyaparLineItems
            items={items}
            onChange={setItems}
            isGst={true}
            searchMode="catalog"
            defaultRateFrom="purchase"
            godownId={godownId}
            showHsn={true}
            showUnit={true}
          />
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex gap-3 justify-end flex-wrap pb-6">
        <Button type="button" variant="outline" onClick={() => navigate('/purchases')}>Cancel</Button>
        <Button
          onClick={() => createPO.mutate()}
          disabled={!canSave}
          loading={createPO.isPending}
        >
          Save Purchase Order
        </Button>
      </div>

      <QuickAddPartySheet
        open={quickAddOpen}
        onOpenChange={setQuickAddOpen}
        defaultName={quickAddDefaultName}
        onCreated={(row) => {
          selectSupplier(row);
          qc.invalidateQueries({ queryKey: ['parties'] });
        }}
      />

      <OcrBillSheet
        open={ocrOpen}
        onOpenChange={setOcrOpen}
        context="Supplier Quotation / Invoice"
        onConfirm={handleOcrConfirm}
      />
    </div>
  );
}
