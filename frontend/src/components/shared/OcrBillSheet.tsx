/**
 * OcrBillSheet
 * A slide-over that:
 *  1. Lets the user pick / drag-drop a bill image or PDF
 *  2. Uploads it to POST /api/ocr/extract
 *  3. Shows a structured preview of the extracted fields
 *  4. Calls onConfirm(data) so the parent form can apply the values
 */
import { useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScanLine, Upload, Loader2, CheckCircle2, AlertCircle, FileText, Image as ImageIcon } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { paiseToRupees, rupeesToPaise } from '@/lib/formatters';

interface OcrCandidate<T> {
  value: T;
  confidence: number;
  source: string;
  reason: string;
}

interface OcrItemCandidate {
  description: string;
  hsn_code: string | null;
  quantity: number | null;
  unit: string | null;
  rate_paise: number | null;
  amount_paise: number | null;
  discount_paise?: number | null;
  gst_rate?: number | null;
  cess_rate?: number | null;
  confidence: number;
  source: string;
}

export interface OcrResult {
  invoice_number: string | null;
  bill_date: string | null;         // YYYY-MM-DD
  party_name: string | null;
  supplier_gstin: string | null;
  buyer_gstin: string | null;
  total_amount_paise: number | null;
  due_date?: string | null;
  party_address?: string | null;
  shipping_address?: string | null;
  party_phone?: string | null;
  place_of_supply?: string | null;
  tax_summary?: {
    taxable_amount_paise?: number | null;
    cgst_paise?: number | null;
    sgst_paise?: number | null;
    igst_paise?: number | null;
    cess_paise?: number | null;
    discount_paise?: number | null;
    round_off_paise?: number | null;
    gst_rate?: number | null;
  };
  reference_invoice?: Record<string, string | null>;
  raw_lines: string[];
  matched_party_id?: string | null;
  matched_party_name?: string | null;
  party_match_confidence?: number;
  party_match_reason?: string | null;
  matched_party?: any | null;
  document_type?: string;
  confidence?: number;
  warnings?: string[];
  fields?: {
    invoice_number?: OcrCandidate<string> | null;
    bill_date?: OcrCandidate<string> | null;
    party_name?: OcrCandidate<string> | null;
    supplier_gstin?: OcrCandidate<string> | null;
    total_amount_paise?: OcrCandidate<number> | null;
  };
  candidates?: {
    invoice_numbers?: OcrCandidate<string>[];
    dates?: OcrCandidate<string>[];
    gstins?: OcrCandidate<string>[];
    totals?: OcrCandidate<number>[];
  };
  items?: OcrItemCandidate[];
}

interface FieldState {
  invoice_number: string;
  bill_date: string;
  party_name: string;
  supplier_gstin: string;
  total_amount_rupees: string;
  due_date: string;
  party_phone: string;
  party_address: string;
  shipping_address: string;
  place_of_supply: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when the user clicks "Apply to Form" */
  onConfirm: (result: OcrResult & { overrides: FieldState }) => void;
  /** Context label shown in the sheet header, e.g. "Purchase Bill" or "Sales Invoice" */
  context?: string;
}

export default function OcrBillSheet({ open, onOpenChange, onConfirm, context = 'Bill' }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OcrResult | null>(null);
  const [selectedItems, setSelectedItems] = useState<OcrItemCandidate[]>([]);
  const [fields, setFields] = useState<FieldState>({
    invoice_number: '',
    bill_date: '',
    party_name: '',
    supplier_gstin: '',
    total_amount_rupees: '',
    due_date: '',
    party_phone: '',
    party_address: '',
    shipping_address: '',
    place_of_supply: '',
  });
  const [previewFile, setPreviewFile] = useState<{ name: string; isImage: boolean } | null>(null);

  const DOCUMENT_TYPE_ROUTES: Record<string, string> = {
    purchase_bill: '/purchase-expense/bills',
    sales_invoice: '/sales/new',
    delivery_challan: '/job-work/new',
    quotation: '/purchase-expense/orders',
  };

  useEffect(() => {
    if (result?.items) {
      setSelectedItems(result.items);
    } else {
      setSelectedItems([]);
    }
  }, [result]);

  const resetState = () => {
    setResult(null);
    setPreviewFile(null);
    setSelectedItems([]);
    setFields({
      invoice_number: '', bill_date: '', party_name: '', supplier_gstin: '', total_amount_rupees: '',
      due_date: '', party_phone: '', party_address: '', shipping_address: '', place_of_supply: '',
    });
  };

  const processFile = async (file: File) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowed.includes(file.type)) {
      toast.error('Please upload a JPG, PNG, WebP, or PDF file');
      return;
    }
    const isImage = file.type.startsWith('image/');
    setPreviewFile({ name: file.name, isImage });
    setLoading(true);
    setResult(null);

    try {
      const form = new FormData();
      form.append('file', file);
      form.append('context', context);
      const { data: res } = await api.post('/ocr/extract', form);
      const data: OcrResult = res.data;
      setResult(data);
      // Pre-populate editable fields from OCR result
      setFields({
        invoice_number: data.invoice_number ?? '',
        bill_date: data.bill_date ?? '',
        party_name: data.matched_party_name ?? data.party_name ?? '',
        supplier_gstin: data.supplier_gstin ?? '',
        total_amount_rupees: data.total_amount_paise != null
          ? paiseToRupees(data.total_amount_paise).toFixed(2)
          : '',
        due_date: data.due_date ?? '',
        party_phone: data.party_phone ?? '',
        party_address: data.party_address ?? '',
        shipping_address: data.shipping_address ?? '',
        place_of_supply: data.place_of_supply ?? '',
      });
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'OCR failed — try a clearer image or text-based PDF');
      setPreviewFile(null);
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const handleConfirm = () => {
    if (!result) return;
    const totalPaise = fields.total_amount_rupees
      ? rupeesToPaise(fields.total_amount_rupees)
      : result.total_amount_paise;

    const finalResult = {
      ...result,
      invoice_number: fields.invoice_number || result.invoice_number,
      bill_date: fields.bill_date || result.bill_date,
      party_name: fields.party_name || result.party_name,
      supplier_gstin: fields.supplier_gstin || result.supplier_gstin,
      total_amount_paise: totalPaise,
      due_date: fields.due_date || result.due_date,
      party_phone: fields.party_phone || result.party_phone,
      party_address: fields.party_address || result.party_address,
      shipping_address: fields.shipping_address || result.shipping_address,
      place_of_supply: fields.place_of_supply || result.place_of_supply,
      items: selectedItems,
      overrides: fields,
    };

    const targetRoute = result.document_type ? DOCUMENT_TYPE_ROUTES[result.document_type] : null;
    const currentPath = window.location.pathname;

    const isCurrentMatch = (target: string, current: string) => {
      if (target === '/sales/new' && (current.startsWith('/sales/') || current === '/sales/new')) return true;
      if (target === '/job-work/new' && (current.startsWith('/job-work/') || current === '/job-work/new')) return true;
      if (target === '/purchase-expense/bills' && current.startsWith('/purchase-expense')) return true;
      if (target === '/purchase-expense/orders' && current.startsWith('/purchase-expense')) return true;
      return false;
    };

    if (targetRoute && !isCurrentMatch(targetRoute, currentPath)) {
      toast.success(`Redirecting to the correct form for ${result.document_type?.replace(/_/g, ' ') || 'document'}...`);
      navigate(targetRoute, { state: { ocrData: finalResult } });
    } else {
      onConfirm(finalResult);
    }

    onOpenChange(false);
    resetState();
  };

  const handleClose = () => {
    onOpenChange(false);
    resetState();
  };

  const upd = (k: keyof FieldState, v: string) => setFields(f => ({ ...f, [k]: v }));
  const confidenceLabel = (value?: number) => `${Math.round((value || 0) * 100)}%`;
  const fieldConfidence = (key: keyof NonNullable<OcrResult['fields']>) => result?.fields?.[key]?.confidence;
  const fieldSource = (key: keyof NonNullable<OcrResult['fields']>) => result?.fields?.[key]?.source;

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="mb-6">
          <SheetTitle className="flex items-center gap-2">
            <ScanLine className="w-5 h-5 text-primary" />
            Scan {context}
          </SheetTitle>
          <SheetDescription>
            Upload a photo or PDF of the {context.toLowerCase()}. The system will extract key details automatically.
          </SheetDescription>
        </SheetHeader>

        {/* Upload Zone */}
        {!result && (
          <div
            className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors cursor-pointer mb-6
              ${dragOver ? 'border-primary bg-primary/5' : 'border-slate-200 hover:border-primary/50 hover:bg-slate-50'}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input ref={fileInputRef} type="file" className="hidden" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={handleFileChange} />
            {loading ? (
              <div className="flex flex-col items-center gap-3 text-muted-foreground">
                <Loader2 className="w-10 h-10 animate-spin text-primary" />
                <p className="font-medium">Scanning {previewFile?.name}…</p>
                <p className="text-xs">This may take a few seconds for images</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 text-muted-foreground">
                <Upload className="w-10 h-10" />
                <div>
                  <p className="font-semibold text-slate-700">Click to upload or drag & drop</p>
                  <p className="text-xs mt-1">JPG, PNG, WebP, or PDF — max 15 MB</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Extracted Fields */}
        {result && (
          <div className="space-y-5">
            <div className="flex items-center gap-2 p-3 bg-emerald-50 text-emerald-700 rounded-lg text-sm font-medium border border-emerald-200">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              {previewFile?.isImage ? <ImageIcon className="w-4 h-4 shrink-0" /> : <FileText className="w-4 h-4 shrink-0" />}
              Scanned: <span className="truncate">{previewFile?.name}</span>
              <div className="ml-auto flex items-center gap-2 shrink-0">
                {result.confidence != null && (
                  <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs text-emerald-800">
                    {confidenceLabel(result.confidence)}
                  </span>
                )}
                <button className="text-xs underline" onClick={resetState}>Rescan</button>
              </div>
            </div>
            {(result.document_type || result.warnings?.length) && (
              <div className="rounded-lg border bg-slate-50 p-3 space-y-2">
                {result.document_type && (
                  <div className="text-xs text-slate-600">
                    Document type: <span className="font-semibold capitalize">{result.document_type.replace(/_/g, ' ')}</span>
                  </div>
                )}
                {result.warnings?.map((w, idx) => (
                  <div key={idx} className="flex gap-2 text-xs text-amber-700">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Editable extracted fields */}
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Verify &amp; correct extracted details</p>
              {result.matched_party_id && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                  Matched existing party: <span className="font-semibold">{result.matched_party_name}</span>
                  {result.party_match_reason === 'gstin_exact' ? ' by GSTIN' : ' by name'}
                </div>
              )}

              <div>
                <Label className="text-xs flex items-center justify-between">
                  <span>Bill / Invoice Number</span>
                  {fieldConfidence('invoice_number') != null && <span className="text-muted-foreground">{confidenceLabel(fieldConfidence('invoice_number'))}</span>}
                </Label>
                <Input className="mt-1" value={fields.invoice_number} onChange={e => upd('invoice_number', e.target.value)} placeholder="Not detected — enter manually" />
                {fieldSource('invoice_number') && <p className="mt-1 text-[11px] text-muted-foreground truncate">Source: {fieldSource('invoice_number')}</p>}
              </div>

              <div>
                <Label className="text-xs flex items-center justify-between">
                  <span>Bill Date</span>
                  {fieldConfidence('bill_date') != null && <span className="text-muted-foreground">{confidenceLabel(fieldConfidence('bill_date'))}</span>}
                </Label>
                <Input className="mt-1" type="date" value={fields.bill_date} onChange={e => upd('bill_date', e.target.value)} />
                {fieldSource('bill_date') && <p className="mt-1 text-[11px] text-muted-foreground truncate">Source: {fieldSource('bill_date')}</p>}
              </div>

              <div>
                <Label className="text-xs flex items-center justify-between">
                  <span>Party / Supplier Name</span>
                  {fieldConfidence('party_name') != null && <span className="text-muted-foreground">{confidenceLabel(fieldConfidence('party_name'))}</span>}
                </Label>
                <Input className="mt-1" value={fields.party_name} onChange={e => upd('party_name', e.target.value)} placeholder="Not detected" />
                {fieldSource('party_name') && <p className="mt-1 text-[11px] text-muted-foreground truncate">Source: {fieldSource('party_name')}</p>}
              </div>

              <div>
                <Label className="text-xs flex items-center justify-between">
                  <span>GSTIN</span>
                  {fieldConfidence('supplier_gstin') != null && <span className="text-muted-foreground">{confidenceLabel(fieldConfidence('supplier_gstin'))}</span>}
                </Label>
                <Input className="mt-1 font-mono text-xs" value={fields.supplier_gstin} onChange={e => upd('supplier_gstin', e.target.value.toUpperCase())} placeholder="e.g. 27AABCU9603R1ZM" />
                {fieldSource('supplier_gstin') && <p className="mt-1 text-[11px] text-muted-foreground truncate">Source: {fieldSource('supplier_gstin')}</p>}
              </div>

              <div>
                <Label className="text-xs flex items-center justify-between">
                  <span>Total Amount (₹)</span>
                  {fieldConfidence('total_amount_paise') != null && <span className="text-muted-foreground">{confidenceLabel(fieldConfidence('total_amount_paise'))}</span>}
                </Label>
                <Input className="mt-1" type="number" step="0.01" value={fields.total_amount_rupees} onChange={e => upd('total_amount_rupees', e.target.value)} placeholder="0.00" />
                {fieldSource('total_amount_paise') && <p className="mt-1 text-[11px] text-muted-foreground truncate">Source: {fieldSource('total_amount_paise')}</p>}
              </div>

              <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
                <div>
                  <Label className="text-xs">Due Date</Label>
                  <Input className="mt-1" type="date" value={fields.due_date} onChange={e => upd('due_date', e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Party Phone</Label>
                  <Input className="mt-1" value={fields.party_phone} onChange={e => upd('party_phone', e.target.value)} placeholder="Not detected" />
                </div>
                <div className="sm:col-span-2">
                  <Label className="text-xs">Billing Address</Label>
                  <Input className="mt-1" value={fields.party_address} onChange={e => upd('party_address', e.target.value)} placeholder="Not detected" />
                </div>
                <div className="sm:col-span-2">
                  <Label className="text-xs">Shipping Address</Label>
                  <Input className="mt-1" value={fields.shipping_address} onChange={e => upd('shipping_address', e.target.value)} placeholder="Not detected" />
                </div>
                <div>
                  <Label className="text-xs">Place of Supply / State Code</Label>
                  <Input className="mt-1" value={fields.place_of_supply} onChange={e => upd('place_of_supply', e.target.value)} placeholder="e.g. 24 or Gujarat" />
                </div>
              </div>
            </div>
            {result.items && result.items.length > 0 && (
              <div className="space-y-2.5 rounded-lg border p-3 bg-muted/10">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase text-muted-foreground tracking-wider flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5" /> Detected Items ({result.items.length})
                  </span>
                  <button
                    type="button"
                    className="text-xs font-semibold text-primary hover:underline"
                    onClick={() => {
                      if (selectedItems.length === result.items?.length) {
                        setSelectedItems([]);
                      } else {
                        setSelectedItems(result.items || []);
                      }
                    }}
                  >
                    {selectedItems.length === result.items?.length ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
                <div className="max-h-48 overflow-y-auto rounded-md border divide-y bg-background">
                  {result.items.map((item, idx) => {
                    const checked = selectedItems.includes(item);
                    const rate = item.rate_paise != null
                      ? item.rate_paise / 100
                      : (item.amount_paise != null && item.quantity ? (item.amount_paise / item.quantity) / 100 : 0);
                    const amount = item.amount_paise != null ? item.amount_paise / 100 : rate * (item.quantity || 1);
                    return (
                      <label key={idx} className="flex items-start gap-3 p-2.5 text-xs hover:bg-muted/30 cursor-pointer select-none transition-colors">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 rounded border-input text-primary focus:ring-primary cursor-pointer"
                          checked={checked}
                          onChange={() => {
                            setSelectedItems((prev) =>
                              prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]
                            );
                          }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-slate-800 break-all">{item.description}</div>
                          <div className="text-muted-foreground mt-0.5">
                            Qty {item.quantity || 1} {item.unit || 'PCS'} · Rate ₹{rate.toFixed(2)}
                            {item.gst_rate != null && <> · GST {item.gst_rate}%</>}
                            {' · '}Amount ₹{amount.toFixed(2)}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
                <div className="text-[11px] text-muted-foreground font-medium">
                  {selectedItems.length} of {result.items.length} items will be imported to the form.
                </div>
              </div>
            )}

            {/* Raw lines preview (collapsed) */}
            {result.raw_lines.length > 0 && (
              <details className="rounded-lg border">
                <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-slate-600 flex items-center gap-2 select-none">
                  <FileText className="w-4 h-4" /> View raw extracted text
                </summary>
                <div className="px-4 pb-4 pt-2 max-h-48 overflow-y-auto">
                  <pre className="text-xs text-slate-500 whitespace-pre-wrap leading-relaxed font-mono">
                    {result.raw_lines.join('\n')}
                  </pre>
                </div>
              </details>
            )}

            {/* No fields detected warning */}
            {!fields.invoice_number && !fields.bill_date && !fields.party_name && !fields.total_amount_rupees && (
              <div className="flex items-start gap-2 p-3 bg-amber-50 text-amber-700 rounded-lg text-sm border border-amber-200">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>Few fields were detected. This often happens with low-quality scans or handwritten bills. Enter the details manually above.</span>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button className="flex-1" onClick={handleConfirm}>
                Apply to Form
              </Button>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
