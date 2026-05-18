import { useMemo, useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useExpenses, useCreateExpense } from '@/hooks/useBusiness';
import { formatMoney, formatDate } from '@/lib/formatters';
import { determineGSTType, previewExpenseGst, stateCodeFromGstin } from '@/lib/expenseGst';
import { GST_RATE_OPTIONS } from '@/lib/gstRates';
import { useAuthStore } from '@/store/authStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Plus, Search, Receipt } from 'lucide-react';
import MoneyInput from '@/components/transactions/MoneyInput';
import { useTransactionDraft } from '@/hooks/useTransactionDraft';
import toast from 'react-hot-toast';

const CATEGORIES = ['Rent', 'Salary', 'Utilities', 'Travel', 'Office Supplies', 'Marketing', 'Insurance', 'Maintenance', 'Professional Fees', 'Packaging', 'Courier', 'Other'];

export default function ExpenseList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState<any>({ page: 1, limit: 25 });
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    if (searchParams.get('add') !== '1') return;
    setShowForm(true);
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.delete('add');
        return n;
      },
      { replace: true }
    );
  }, [searchParams, setSearchParams]);

  const { data, isLoading } = useExpenses({ ...filters, search: search || undefined });
  const createMutation = useCreateExpense();

  const expenses = data?.data?.data || [];
  const pagination = data?.data?.pagination;
  const meta = data?.meta || {};

  const company = useAuthStore((s) => s.company);
  const [form, setForm] = useState<any>({
    expense_date: new Date().toISOString().split('T')[0],
    payment_mode: 'cash',
    gst_rate: 0,
    amount_includes_gst: false,
  });
  const u = (f: string, v: any) => setForm((p: any) => ({ ...p, [f]: v }));

  const { clearDraft } = useTransactionDraft(
    'bizflow:draft:expense',
    { showForm, form },
    (draft: any) => {
      if (draft.form && typeof draft.form === 'object') setForm((prev: any) => ({ ...prev, ...draft.form }));
      if (draft.showForm || draft.form?.category || draft.form?.amount || draft.form?.vendor_name || draft.form?.description) setShowForm(true);
    },
    {
      shouldSave: (draft) => Boolean(
        draft.showForm || draft.form?.category || draft.form?.amount || draft.form?.vendor_name ||
        draft.form?.vendor_gstin || draft.form?.description
      ),
    },
  );

  const gstPreview = useMemo(() => {
    const paise = Math.round((Number(form.amount) || 0) * 100);
    const buyer = stateCodeFromGstin(company?.gstin) || '';
    const supplier = stateCodeFromGstin(form.vendor_gstin) || buyer;
    const gstType = determineGSTType(supplier, buyer || supplier);
    return previewExpenseGst(paise, Number(form.gst_rate) || 0, gstType, !!form.amount_includes_gst);
  }, [form.amount, form.gst_rate, form.vendor_gstin, form.amount_includes_gst, company?.gstin]);

  const handleCreate = async () => {
    if (!form.category) { toast.error('Category is required'); return; }
    if (!form.amount || form.amount <= 0) { toast.error('Amount must be positive'); return; }
    try {
      await createMutation.mutateAsync({
        ...form,
        amount: Math.round(form.amount * 100),
        amount_includes_gst: !!form.amount_includes_gst,
      });
      toast.success('Expense added');
      clearDraft();
      setShowForm(false);
      setForm({
        expense_date: new Date().toISOString().split('T')[0],
        payment_mode: 'cash',
        gst_rate: 0,
        amount_includes_gst: false,
      });
    } catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold">Expenses</h1><p className="text-muted-foreground text-sm">Track business expenses</p></div>
        <Button size="sm" onClick={() => setShowForm(true)}><Plus className="w-4 h-4 mr-1" />Add Expense</Button>
      </div>

      {/* Category breakdown */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        <Card className="shrink-0 min-w-[160px]"><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Total</p>
          <p className="text-lg font-bold tabular-nums">{formatMoney(meta.total_expenses || 0)}</p>
        </CardContent></Card>
        {(meta.by_category || []).slice(0, 4).map((c: any) => (
          <Card key={c.category} className="shrink-0 min-w-[140px]"><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{c.category}</p>
            <p className="text-lg font-bold tabular-nums">{formatMoney(parseInt(c.total))}</p>
            <p className="text-[10px] text-muted-foreground">{c.cnt} entries</p>
          </CardContent></Card>
        ))}
      </div>

      <div className="flex gap-3 items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search expenses..." className="pl-9" value={search} onChange={e => { setSearch(e.target.value); setFilters((f: any) => ({ ...f, page: 1 })); }} />
        </div>
      </div>

      <div className="border rounded-xl bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b bg-muted/40">
            <th className="p-3 text-left font-medium">Date</th>
            <th className="p-3 text-left font-medium">Category</th>
            <th className="p-3 text-left font-medium hidden md:table-cell">Description</th>
            <th className="p-3 text-left font-medium hidden lg:table-cell">Vendor</th>
            <th className="p-3 text-center font-medium hidden md:table-cell">Mode</th>
            <th className="p-3 text-right font-medium">Amount</th>
          </tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} className="p-12 text-center text-muted-foreground">Loading...</td></tr>}
            {!isLoading && expenses.length === 0 && <tr><td colSpan={6} className="p-12 text-center text-muted-foreground"><Receipt className="w-12 h-12 mx-auto mb-3 opacity-30" />No expenses recorded</td></tr>}
            {expenses.map((e: any) => (
              <tr key={e.id} className="border-b hover:bg-muted/30">
                <td className="p-3 text-muted-foreground">{formatDate(e.expense_date)}</td>
                <td className="p-3"><Badge variant="outline" className="text-[10px]">{e.category}</Badge></td>
                <td className="p-3 hidden md:table-cell text-muted-foreground truncate max-w-[200px]">{e.description || '—'}</td>
                <td className="p-3 hidden lg:table-cell text-muted-foreground">{e.vendor_name || '—'}</td>
                <td className="p-3 text-center hidden md:table-cell capitalize text-xs text-muted-foreground">{e.payment_mode?.replace('_', ' ')}</td>
                <td className="p-3 text-right tabular-nums font-semibold">{formatMoney(e.total_amount)}</td>
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

      {/* Create Expense Sheet */}
      <Sheet open={showForm} onOpenChange={setShowForm}>
        <SheetContent><SheetHeader className="mb-6"><SheetTitle>Add Expense</SheetTitle></SheetHeader>
          <div className="space-y-4">
            <div><Label>Category *</Label>
              <select className="mt-1 w-full h-9 rounded-md border bg-transparent px-3 text-sm" value={form.category || ''} onChange={e => u('category', e.target.value)}>
                <option value="">Select category</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div><Label>Amount (₹) *</Label><MoneyInput className="mt-1 text-lg" value={Math.round((Number(form.amount) || 0) * 100)} onChange={paise => u('amount', paise / 100)} />
              <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <input type="checkbox" checked={!!form.amount_includes_gst} onChange={e => u('amount_includes_gst', e.target.checked)} className="rounded border" />
                Amount is bill total (GST included). Leave off if you enter taxable value before GST.
              </label>
            </div>
            <div><Label>Date</Label><Input type="date" className="mt-1" value={form.expense_date} onChange={e => u('expense_date', e.target.value)} /></div>
            <div><Label>GST Rate</Label><div className="flex gap-2 mt-1">
              {GST_RATE_OPTIONS.map(r => (<button key={r} onClick={() => u('gst_rate', r)} className={`flex-1 py-1.5 rounded text-xs font-medium ${form.gst_rate === r ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{r}%</button>))}
            </div></div>
            {(Number(form.amount) > 0 && (form.gst_rate ?? 0) > 0) && (
              <div className="rounded-lg border bg-muted/30 p-3 text-xs space-y-1 tabular-nums">
                <p className="font-medium text-foreground">Recorded split (preview)</p>
                <p className="text-muted-foreground">Taxable {formatMoney(gstPreview.taxable)} · CGST {formatMoney(gstPreview.cgst)} · SGST {formatMoney(gstPreview.sgst)} · IGST {formatMoney(gstPreview.igst)}</p>
                <p className="text-foreground font-medium">Total {formatMoney(gstPreview.total)}</p>
                <p className="text-[10px] text-muted-foreground">Intra-state vs inter-state follows vendor GSTIN vs your company GSTIN (first two digits = state).</p>
              </div>
            )}
            <div><Label>Payment Mode</Label>
              <select className="mt-1 w-full h-9 rounded-md border bg-transparent px-3 text-sm" value={form.payment_mode} onChange={e => u('payment_mode', e.target.value)}>
                <option value="cash">Cash</option><option value="upi">UPI</option>
                <option value="bank_transfer">Bank Transfer</option><option value="cheque">Cheque</option><option value="card">Card</option>
              </select>
            </div>
            <div><Label>Vendor Name</Label><Input className="mt-1" value={form.vendor_name || ''} onChange={e => u('vendor_name', e.target.value)} /></div>
            <div><Label>Vendor GSTIN</Label><Input className="mt-1 uppercase font-mono" maxLength={15} value={form.vendor_gstin || ''} onChange={e => u('vendor_gstin', e.target.value.toUpperCase())} /></div>
            <div><Label>Description</Label><textarea rows={2} className="mt-1 w-full rounded-md border px-3 py-2 text-sm bg-transparent resize-none" value={form.description || ''} onChange={e => u('description', e.target.value)} /></div>
            <div className="flex gap-3 mt-6 pt-4 border-t">
              <Button variant="outline" className="flex-1" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button className="flex-1" loading={createMutation.isPending} onClick={handleCreate}>
                Save Expense
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
