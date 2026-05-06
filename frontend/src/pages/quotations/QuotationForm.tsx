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
import { ArrowLeft, UserPlus } from 'lucide-react';
import { QuickAddPartySheet } from '@/components/parties/QuickAddPartySheet';
import { DOCUMENT_THEME_OPTIONS, INVOICE_PDF_TEMPLATES, type DocumentThemeId, type InvoicePdfTemplateId } from '@/components/invoices/InvoicePreviewWorkspace';
import VyaparLineItems, { type VyaparLineItem } from '@/components/shared/VyaparLineItems';

export default function QuotationForm() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: godownRes } = useGodowns();
  const godowns = (godownRes as any)?.data ?? [];

  // Party
  const [partyId, setPartyId] = useState('');
  const [partyName, setPartyName] = useState('');
  const [partySearch, setPartySearch] = useState('');
  const [partyResults, setPartyResults] = useState<any[]>([]);
  const [partySearchLoading, setPartySearchLoading] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddDefaultName, setQuickAddDefaultName] = useState('');

  // Doc info
  const [godownId, setGodownId] = useState('');
  const [quotationNumber, setQuotationNumber] = useState('');
  const [quotationDate, setQuotationDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [validUntil, setValidUntil] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 14); return d.toISOString().split('T')[0];
  });

  // Overrides
  const [partyNameOverride, setPartyNameOverride] = useState('');
  const [partyPhoneOverride, setPartyPhoneOverride] = useState('');
  const [partyEmailOverride, setPartyEmailOverride] = useState('');

  // Settings
  const [isGstQuote, setIsGstQuote] = useState(true);
  const [isInterstate, setIsInterstate] = useState(false);
  const [pdfTemplate, setPdfTemplate] = useState<InvoicePdfTemplateId>('standard');
  const [documentTheme, setDocumentTheme] = useState<DocumentThemeId>('classic');
  const [customerNotes, setCustomerNotes] = useState('');
  const [termsAndConditions, setTermsAndConditions] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [showExtras, setShowExtras] = useState(false);

  // Line items
  const [items, setItems] = useState<VyaparLineItem[]>([]);

  const defaultGodown = useMemo(() => {
    const def = godowns.find((g: any) => g.is_default);
    return def?.id ?? godowns[0]?.id ?? '';
  }, [godowns]);

  useEffect(() => {
    if (!godownId && defaultGodown) setGodownId(defaultGodown);
  }, [godownId, defaultGodown]);

  const searchParties = async (q: string) => {
    setPartySearch(q);
    if (q.length < 2) { setPartyResults([]); setPartySearchLoading(false); return; }
    setPartySearchLoading(true);
    try {
      const { data: res } = await api.get('/parties/search', { params: { q } });
      setPartyResults(res.data || []);
    } catch { setPartyResults([]); }
    finally { setPartySearchLoading(false); }
  };

  const selectParty = (p: any) => {
    const rawId = p?.id;
    const id =
      rawId != null && rawId !== '' && String(rawId) !== 'undefined' ? String(rawId) : '';
    if (!id) {
      toast.error('Could not select party — invalid id. Try again or add the party under Parties.');
      return;
    }
    setPartyId(id);
    setPartyName(String(p.name ?? ''));
    setPartySearch('');
    setPartyResults([]);
  };

  const clearParty = () => {
    setPartyId(''); setPartyName('');
    setPartySearch(''); setPartyResults([]);
  };

  const create = useMutation({
    mutationFn: async () => {
      const payload = {
        party_id: partyId || undefined,
        godown_id: godownId || undefined,
        quotation_number: quotationNumber.trim() || undefined,
        quotation_date: quotationDate,
        valid_until: validUntil || undefined,
        is_gst_quote: isGstQuote,
        pdf_template: pdfTemplate,
        document_theme: documentTheme,
        party_name_override: partyNameOverride.trim() || undefined,
        party_phone_override: partyPhoneOverride.trim() || undefined,
        party_email_override: partyEmailOverride.trim() || undefined,
        customer_notes: customerNotes.trim() || undefined,
        internal_notes: internalNotes.trim() || undefined,
        terms_and_conditions: termsAndConditions.trim() || undefined,
        items: items.map((item) => ({
          item_id: item.item_id,
          item_name: item.name,
          item_description: item.description || undefined,
          hsn_code: item.hsn_code || undefined,
          unit: item.unit || 'PCS',
          quantity: item.quantity,
          unit_price: item.unit_price,
          discount_amount: item.discount_amount,
          gst_rate: isGstQuote ? item.gst_rate : 0,
        })),
      };
      return api.post('/quotations', payload);
    },
    onSuccess: (res) => {
      toast.success('Quotation created');
      qc.invalidateQueries({ queryKey: ['quotations'] });
      const id = (res.data?.data?.id ?? res.data?.id);
      navigate(id ? `/quotations/${id}` : '/quotations');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || e.message || 'Failed to create quotation'),
  });

  const canSave = items.length > 0 && !!quotationDate;

  return (
    <div className="max-w-4xl mx-auto space-y-5 pb-12">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/quotations')}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">New Quotation</h1>
          <p className="text-sm text-muted-foreground">Send a price offer before raising an invoice</p>
        </div>
      </div>

      {/* Party + Doc Info side by side */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Party */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Bill to (party)</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {partyId ? (
              <div className="flex items-center justify-between p-2.5 rounded-lg border bg-muted/30">
                <span className="font-medium text-sm">{partyName}</span>
                <button type="button" className="text-xs text-primary hover:underline" onClick={clearParty}>Change</button>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      placeholder="Search party by name, phone, GSTIN…"
                      value={partySearch}
                      onChange={(e) => searchParties(e.target.value)}
                    />
                    {partyResults.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-card border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                        {partyResults.map((p) => (
                          <button key={p.id} type="button" className="w-full text-left px-3 py-2 hover:bg-muted text-sm" onClick={() => selectParty(p)}>
                            <span className="font-medium">{p.name}</span>
                            {p.phone && <span className="text-muted-foreground ml-2 text-xs">{p.phone}</span>}
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
                      Add "{partySearch.trim()}"
                    </button>
                  </p>
                )}
                <p className="text-xs text-muted-foreground">Optional — leave blank to enter party name manually on the quote</p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Doc Info */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Quotation Details</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Quote Date</Label>
                <Input type="date" className="mt-1 h-9" value={quotationDate} onChange={(e) => setQuotationDate(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Valid Until</Label>
                <Input type="date" className="mt-1 h-9" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Quote No. (optional)</Label>
                <Input className="mt-1 h-9 font-mono text-xs" placeholder="Auto-generated" value={quotationNumber} onChange={(e) => setQuotationNumber(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Godown</Label>
                <select className="mt-1 w-full h-9 rounded-md border bg-background px-3 text-sm" value={godownId} onChange={(e) => setGodownId(e.target.value)}>
                  <option value="">—</option>
                  {godowns.map((g: any) => <option key={g.id} value={g.id}>{g.name}{g.is_default ? ' (default)' : ''}</option>)}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-2 text-sm cursor-pointer rounded-md border px-3 h-8">
                <input type="checkbox" checked={isGstQuote} onChange={(e) => setIsGstQuote(e.target.checked)} />
                GST quotation
              </label>
              {isGstQuote && (
                <label className="flex items-center gap-2 text-sm cursor-pointer rounded-md border px-3 h-8">
                  <input type="checkbox" checked={isInterstate} onChange={(e) => setIsInterstate(e.target.checked)} />
                  Interstate (IGST)
                </label>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Line Items */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Items / Services</CardTitle>
        </CardHeader>
        <CardContent>
          <VyaparLineItems
            items={items}
            onChange={setItems}
            isGst={isGstQuote}
            isInterstate={isInterstate}
            searchMode="invoice"
            godownId={godownId}
            showHsn={true}
            showUnit={true}
            showDescription={true}
          />
        </CardContent>
      </Card>

      {/* Extras toggle */}
      <div>
        <button
          type="button"
          className="text-sm text-primary hover:underline flex items-center gap-1"
          onClick={() => setShowExtras(!showExtras)}
        >
          {showExtras ? '▲' : '▼'} {showExtras ? 'Hide' : 'Show'} notes, terms & PDF options
        </button>
      </div>

      {showExtras && (
        <Card>
          <CardContent className="pt-5 space-y-4">
            <div className="grid md:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">PDF Template</Label>
                <select className="mt-1 w-full h-9 rounded-md border bg-background px-3 text-sm" value={pdfTemplate} onChange={(e) => setPdfTemplate(e.target.value as InvoicePdfTemplateId)}>
                  {INVOICE_PDF_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">Theme</Label>
                <select className="mt-1 w-full h-9 rounded-md border bg-background px-3 text-sm" value={documentTheme} onChange={(e) => setDocumentTheme(e.target.value as DocumentThemeId)}>
                  {DOCUMENT_THEME_OPTIONS.map((theme) => <option key={theme.id} value={theme.id}>{theme.label}</option>)}
                </select>
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Display Name (override)</Label>
                <Input className="mt-1 h-9 text-sm" placeholder="Override on PDF" value={partyNameOverride} onChange={(e) => setPartyNameOverride(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Contact Phone (PDF)</Label>
                <Input className="mt-1 h-9 text-sm" value={partyPhoneOverride} onChange={(e) => setPartyPhoneOverride(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Contact Email (PDF)</Label>
                <Input type="email" className="mt-1 h-9 text-sm" value={partyEmailOverride} onChange={(e) => setPartyEmailOverride(e.target.value)} />
              </div>
            </div>

            <div>
              <Label className="text-xs">Party notes <span className="text-muted-foreground">(printed on quote)</span></Label>
              <textarea className="mt-1 w-full rounded-md border px-3 py-2 text-sm bg-transparent resize-none" rows={2} value={customerNotes} onChange={(e) => setCustomerNotes(e.target.value)} placeholder="e.g. Delivery in 7 days, free installation included" />
            </div>
            <div>
              <Label className="text-xs">Terms & Conditions</Label>
              <textarea className="mt-1 w-full rounded-md border px-3 py-2 text-sm bg-transparent resize-none" rows={3} value={termsAndConditions} onChange={(e) => setTermsAndConditions(e.target.value)} placeholder="Payment terms, warranty, validity, exclusions…" />
            </div>
            <div>
              <Label className="text-xs">Internal Notes <span className="text-muted-foreground">(not on PDF)</span></Label>
              <textarea className="mt-1 w-full rounded-md border px-3 py-2 text-sm bg-transparent resize-none" rows={2} value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} placeholder="Margin details, follow-up reminders…" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className="flex gap-3 justify-end flex-wrap pb-6">
        <Button type="button" variant="outline" onClick={() => navigate('/quotations')}>Cancel</Button>
        <Button
          onClick={() => create.mutate()}
          disabled={!canSave}
          loading={create.isPending}
          className="gap-1.5"
        >
          Save Quotation
        </Button>
      </div>

      <QuickAddPartySheet
        open={quickAddOpen}
        onOpenChange={setQuickAddOpen}
        defaultName={quickAddDefaultName}
        onCreated={(row) => {
          selectParty(row);
          qc.invalidateQueries({ queryKey: ['parties'] });
        }}
      />
    </div>
  );
}
