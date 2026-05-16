/**
 * OcrBillSheet
 * A slide-over that:
 *  1. Lets the user pick / drag-drop a bill image or PDF
 *  2. Uploads it to POST /api/ocr/extract
 *  3. Shows a structured preview of the extracted fields
 *  4. Calls onConfirm(data) so the parent form can apply the values
 */
import { useRef, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScanLine, Upload, Loader2, CheckCircle2, AlertCircle, FileText, Image as ImageIcon } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { paiseToRupees, rupeesToPaise } from '@/lib/formatters';

export interface OcrResult {
  invoice_number: string | null;
  bill_date: string | null;         // YYYY-MM-DD
  party_name: string | null;
  supplier_gstin: string | null;
  buyer_gstin: string | null;
  total_amount_paise: number | null;
  raw_lines: string[];
  matched_party_id?: string | null;
  matched_party_name?: string | null;
  party_match_confidence?: number;
  party_match_reason?: string | null;
  matched_party?: any | null;
}

interface FieldState {
  invoice_number: string;
  bill_date: string;
  party_name: string;
  supplier_gstin: string;
  total_amount_rupees: string;
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
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OcrResult | null>(null);
  const [fields, setFields] = useState<FieldState>({
    invoice_number: '',
    bill_date: '',
    party_name: '',
    supplier_gstin: '',
    total_amount_rupees: '',
  });
  const [previewFile, setPreviewFile] = useState<{ name: string; isImage: boolean } | null>(null);

  const resetState = () => {
    setResult(null);
    setPreviewFile(null);
    setFields({ invoice_number: '', bill_date: '', party_name: '', supplier_gstin: '', total_amount_rupees: '' });
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

    onConfirm({
      ...result,
      invoice_number: fields.invoice_number || result.invoice_number,
      bill_date: fields.bill_date || result.bill_date,
      party_name: fields.party_name || result.party_name,
      supplier_gstin: fields.supplier_gstin || result.supplier_gstin,
      total_amount_paise: totalPaise,
      overrides: fields,
    });
    onOpenChange(false);
    resetState();
  };

  const handleClose = () => {
    onOpenChange(false);
    resetState();
  };

  const upd = (k: keyof FieldState, v: string) => setFields(f => ({ ...f, [k]: v }));

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
              <button className="ml-auto text-xs underline shrink-0" onClick={resetState}>Rescan</button>
            </div>

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
                <Label className="text-xs">Bill / Invoice Number</Label>
                <Input className="mt-1" value={fields.invoice_number} onChange={e => upd('invoice_number', e.target.value)} placeholder="Not detected — enter manually" />
              </div>

              <div>
                <Label className="text-xs">Bill Date</Label>
                <Input className="mt-1" type="date" value={fields.bill_date} onChange={e => upd('bill_date', e.target.value)} />
              </div>

              <div>
                <Label className="text-xs">Party / Supplier Name</Label>
                <Input className="mt-1" value={fields.party_name} onChange={e => upd('party_name', e.target.value)} placeholder="Not detected" />
              </div>

              <div>
                <Label className="text-xs">GSTIN</Label>
                <Input className="mt-1 font-mono text-xs" value={fields.supplier_gstin} onChange={e => upd('supplier_gstin', e.target.value.toUpperCase())} placeholder="e.g. 27AABCU9603R1ZM" />
              </div>

              <div>
                <Label className="text-xs">Total Amount (₹)</Label>
                <Input className="mt-1" type="number" step="0.01" value={fields.total_amount_rupees} onChange={e => upd('total_amount_rupees', e.target.value)} placeholder="0.00" />
              </div>
            </div>

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
