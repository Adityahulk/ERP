import { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Download, Printer, Receipt, Send, Mail, MessageSquare } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { formatMoney, formatDate } from '@/lib/formatters';
import toast from 'react-hot-toast';

const SKIP_PREVIEW_KEY = 'bizflow_skip_invoice_preview_after_save';

export const INVOICE_PDF_TEMPLATES = [
  { id: 'standard', label: 'GST standard', group: 'Classic', tip: 'HSN and full CGST/SGST or IGST columns for compliance.' },
  { id: 'simple', label: 'Simple', group: 'Classic', tip: 'Fewer columns — quick retail-style print.' },
  { id: 'performa', label: 'Proforma style', group: 'Minimal', tip: 'Totals-focused layout without detailed tax columns.' },
] as const;

export type InvoicePdfTemplateId = (typeof INVOICE_PDF_TEMPLATES)[number]['id'];
export const DOCUMENT_THEME_OPTIONS = [
  { id: 'classic', label: 'Classic' },
  { id: 'modern', label: 'Modern' },
  { id: 'compact', label: 'Compact' },
  { id: 'executive', label: 'Executive' },
  { id: 'sunrise', label: 'Sunrise' },
  { id: 'forest', label: 'Forest' },
  { id: 'midnight', label: 'Midnight' },
  { id: 'royal', label: 'Royal' },
  { id: 'slate', label: 'Slate' },
  { id: 'retail', label: 'Retail' },
  { id: 'minimal', label: 'Minimal' },
] as const;
export type DocumentThemeId = (typeof DOCUMENT_THEME_OPTIONS)[number]['id'];

type TemplateRow = (typeof INVOICE_PDF_TEMPLATES)[number];

export type InvoicePreviewDraftPayload = {
  invoice_type: string;
  party_id?: string;
  party_name?: string;
  godown_id?: string;
  invoice_date: string;
  due_date?: string;
  is_interstate: boolean;
  notes?: string;
  amount_paid?: number;
  discount_amount?: number;
  items: Array<Record<string, unknown>>;
};

type ShareContext = {
  invoiceNumber: string;
  invoiceDate: string;
  totalAmountPaise: number;
  partyName: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  mode: 'saved' | 'draft';
  invoiceId?: string;
  draftPayload?: InvoicePreviewDraftPayload;
  /** For saved PDFs and thermal print */
  invoiceIdForPrint?: string;
  shareContext: ShareContext;
  partyPhone?: string;
  companyName?: string;
};

function normalizePhone(raw?: string) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `91${digits}`;
  if (digits.startsWith('0') && digits.length === 11) return `91${digits.slice(1)}`;
  return digits;
}

export function readSkipInvoicePreview(): boolean {
  return localStorage.getItem(SKIP_PREVIEW_KEY) === '1';
}

export function InvoicePreviewWorkspace({
  open,
  onClose,
  mode,
  invoiceId,
  draftPayload,
  invoiceIdForPrint,
  shareContext,
  partyPhone,
  companyName,
}: Props) {
  const [template, setTemplate] = useState<InvoicePdfTemplateId>('standard');
  const [theme, setTheme] = useState<DocumentThemeId>('classic');
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [skipNext, setSkipNext] = useState(() => readSkipInvoicePreview());
  const [waSending, setWaSending] = useState(false);

  const grouped = useMemo(() => {
    const m = new Map<string, TemplateRow[]>();
    INVOICE_PDF_TEMPLATES.forEach((t) => {
      if (!m.has(t.group)) m.set(t.group, []);
      m.get(t.group)!.push(t);
    });
    return Array.from(m.entries());
  }, []);

  const revoke = useCallback((url: string | null) => {
    if (url) window.URL.revokeObjectURL(url);
  }, []);

  const loadPdf = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    try {
      let blob: Blob;
      if (mode === 'saved' && invoiceId) {
        const res = await api.get(`/invoices/${invoiceId}/pdf`, {
          params: { template, theme, inline: 1 },
          responseType: 'blob',
        });
        blob = res.data as Blob;
      } else if (mode === 'draft' && draftPayload) {
        const res = await api.post('/invoices/preview-pdf', { ...draftPayload, template, theme }, { responseType: 'blob' });
        blob = res.data as Blob;
      } else {
        return;
      }
      setPdfUrl((prev) => {
        revoke(prev);
        return window.URL.createObjectURL(blob);
      });
    } catch (e: any) {
      toast.error(e.response?.data?.error || e.message || 'Could not load preview');
    } finally {
      setLoading(false);
    }
  }, [open, mode, invoiceId, draftPayload, template, theme, revoke]);

  useEffect(() => {
    if (!open) return;
    loadPdf();
  }, [open, loadPdf]);

  useEffect(() => {
    return () => {
      setPdfUrl((prev) => {
        revoke(prev);
        return null;
      });
    };
  }, [revoke]);

  const buildWaMessage = () => {
    const party = shareContext.partyName || 'Customer';
    return `Hi ${party},

Please find invoice ${shareContext.invoiceNumber} dated ${formatDate(shareContext.invoiceDate)} for ${formatMoney(shareContext.totalAmountPaise)}.
Thank you.
— ${companyName || 'Microtechnique Accounts'}`;
  };

  const fetchCurrentPdfFile = async (): Promise<File> => {
    let blob: Blob;
    if (mode === 'saved' && invoiceId) {
      const res = await api.get(`/invoices/${invoiceId}/pdf`, {
        params: { template, theme, inline: 1 },
        responseType: 'blob',
      });
      blob = res.data as Blob;
    } else if (mode === 'draft' && draftPayload) {
      const res = await api.post('/invoices/preview-pdf', { ...draftPayload, template, theme }, { responseType: 'blob' });
      blob = res.data as Blob;
    } else {
      throw new Error('Nothing to share');
    }
    const safeName = `${shareContext.invoiceNumber.replace(/\//g, '-')}.pdf`;
    return new File([blob], safeName, { type: 'application/pdf' });
  };

  const openWhatsApp = async (target: 'web' | 'app') => {
    const phone = normalizePhone(partyPhone);
    if (!phone) {
      toast.error('Add a mobile number on the party to share on WhatsApp.');
      return;
    }
    const text = buildWaMessage();
    setWaSending(true);
    try {
      if (target === 'app') {
        if (navigator.share) {
          const file = await fetchCurrentPdfFile();
          const navAny = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
          const canShareFiles = typeof navAny.canShare === 'function' ? navAny.canShare({ files: [file] }) : false;
          if (canShareFiles) {
            await navigator.share({
              title: `Invoice ${shareContext.invoiceNumber}`,
              text,
              files: [file],
            });
            toast.success('Shared');
            return;
          }
        }
        window.open(`whatsapp://send?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(text)}`, '_blank');
        toast.success('Opening WhatsApp…');
        return;
      }
      const file = await fetchCurrentPdfFile();
      const localUrl = window.URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = localUrl;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(localUrl);
      window.open(`https://web.whatsapp.com/send?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
      toast.success('PDF downloaded — attach it in WhatsApp Web and send.');
    } catch (e: any) {
      toast.error(e?.message || 'WhatsApp failed');
    } finally {
      setWaSending(false);
    }
  };

  const downloadPdf = async () => {
    const t = toast.loading('Preparing PDF…');
    try {
      const file = await fetchCurrentPdfFile();
      const url = window.URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Download started', { id: t });
    } catch (e: any) {
      toast.error(e?.message || 'Download failed', { id: t });
    }
  };

  const printA4 = () => {
    if (!pdfUrl) return;
    window.open(pdfUrl, '_blank', 'noopener,noreferrer');
  };

  const printThermal = async () => {
    const id = invoiceIdForPrint || invoiceId;
    if (!id) {
      toast.error('Save the invoice first to print a thermal receipt.');
      return;
    }
    const w = localStorage.getItem('bizflow_printer_type') === 'thermal58' ? '58' : '80';
    const t = toast.loading('Opening receipt…');
    try {
      const res = await api.get(`/print/receipt/${id}`, { params: { width: w }, responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      window.open(url, '_blank');
      toast.success('Receipt opened', { id: t });
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Print failed', { id: t });
    }
  };

  const openGmail = () => {
    const subject = encodeURIComponent(`Invoice ${shareContext.invoiceNumber}`);
    const body = encodeURIComponent(buildWaMessage());
    window.open(`https://mail.google.com/mail/?view=cm&fs=1&su=${subject}&body=${body}`, '_blank', 'noopener,noreferrer');
  };

  const openSms = () => {
    const phone = normalizePhone(partyPhone);
    const body = encodeURIComponent(buildWaMessage());
    const href = phone ? `sms:${phone}?&body=${body}` : `sms:?&body=${body}`;
    window.location.href = href;
  };

  const handleSaveClose = () => {
    if (skipNext) localStorage.setItem(SKIP_PREVIEW_KEY, '1');
    else localStorage.removeItem(SKIP_PREVIEW_KEY);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black/60 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label="Invoice preview">
      <div className="flex flex-1 min-h-0 m-2 md:m-4 rounded-xl overflow-hidden border border-slate-200/80 bg-white shadow-2xl">
        {/* Themes */}
        <aside className="hidden lg:flex w-56 flex-col border-r border-slate-200 bg-slate-50/90 shrink-0">
          <div className="p-3 border-b border-slate-200 bg-white">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Select theme</p>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-4">
            {grouped.map(([group, items]) => (
              <div key={group}>
                <p className="text-[10px] font-bold text-slate-400 uppercase px-2 mb-1">{group}</p>
                <ul className="space-y-0.5">
                  {items.map((opt) => (
                    <li key={opt.id}>
                      <button
                        type="button"
                        onClick={() => setTemplate(opt.id)}
                        className={`w-full text-left rounded-lg px-2.5 py-2 text-sm transition-colors ${
                          template === opt.id ? 'bg-indigo-600 text-white shadow' : 'text-slate-700 hover:bg-white'
                        }`}
                      >
                        <span className="font-medium">{opt.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase px-2 mb-1">Document Theme</p>
              <ul className="space-y-0.5">
                {DOCUMENT_THEME_OPTIONS.map((opt) => (
                  <li key={opt.id}>
                    <button
                      type="button"
                      onClick={() => setTheme(opt.id)}
                      className={`w-full text-left rounded-lg px-2.5 py-2 text-sm transition-colors ${
                        theme === opt.id ? 'bg-slate-900 text-white shadow' : 'text-slate-700 hover:bg-white'
                      }`}
                    >
                      <span className="font-medium">{opt.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="p-2 border-t border-slate-200 text-[11px] text-slate-500 leading-snug flex gap-2 bg-amber-50/80">
            <span aria-hidden>💡</span>
            <span>Default theme is set in company profile; this screen only overrides the preview and download.</span>
          </div>
        </aside>

        {/* Preview */}
        <div className="flex-1 flex flex-col min-w-0 bg-slate-100">
          <header className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-slate-200 bg-white shrink-0">
            <h2 className="text-sm font-semibold text-slate-800 mr-auto">Preview</h2>
            <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
              <input type="checkbox" checked={skipNext} onChange={(e) => setSkipNext(e.target.checked)} className="rounded border-slate-300" />
              Don&apos;t show after save
            </label>
            <Button size="sm" onClick={handleSaveClose}>
              Save &amp; close
            </Button>
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={onClose} aria-label="Close preview">
              <X className="h-4 w-4" />
            </Button>
          </header>
          <div className="lg:hidden border-b border-slate-200 bg-white px-3 py-2 flex gap-1 overflow-x-auto">
            {INVOICE_PDF_TEMPLATES.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setTemplate(opt.id)}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
                  template === opt.id ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="lg:hidden border-b border-slate-100 bg-white px-3 py-2 flex gap-1 overflow-x-auto">
            {DOCUMENT_THEME_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setTheme(opt.id)}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
                  theme === opt.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="flex-1 min-h-0 p-2 md:p-4">
            {loading && (
              <div className="h-full flex items-center justify-center text-sm text-slate-500">Generating PDF…</div>
            )}
            {!loading && pdfUrl && (
              <iframe title="Invoice PDF preview" src={pdfUrl} className="w-full h-full min-h-[480px] rounded-lg border border-slate-200 bg-white shadow-inner" />
            )}
          </div>
        </div>

        {/* Share */}
        <aside className="w-full sm:w-64 lg:w-72 border-t sm:border-t-0 sm:border-l border-slate-200 bg-white flex flex-col shrink-0 max-h-[40vh] sm:max-h-none overflow-y-auto">
          <div className="p-3 border-b border-slate-200">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Share &amp; export</p>
          </div>
          <div className="p-3 space-y-4 flex-1">
            <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-3 text-center">
              <p className="text-xs font-medium text-emerald-900 mb-2">WhatsApp</p>
              <p className="text-[11px] text-emerald-800/90 mb-2">Send this layout as PDF to your customer.</p>
              <div className="flex flex-col gap-1.5">
                <Button size="sm" className="w-full bg-emerald-600 hover:bg-emerald-700" onClick={() => openWhatsApp('web')} loading={waSending}>
                  <Send className="h-3.5 w-3.5 mr-1.5" /> WhatsApp Web
                </Button>
                <Button size="sm" variant="outline" className="w-full border-emerald-200" onClick={() => openWhatsApp('app')} loading={waSending}>
                  WhatsApp app / share
                </Button>
              </div>
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase mb-2">More</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="flex-1 flex flex-col items-center gap-1 rounded-lg border border-slate-200 py-2 hover:bg-slate-50 text-xs"
                  onClick={() => openGmail()}
                >
                  <Mail className="h-5 w-5 text-red-500" />
                  Gmail
                </button>
                <button
                  type="button"
                  className="flex-1 flex flex-col items-center gap-1 rounded-lg border border-slate-200 py-2 hover:bg-slate-50 text-xs"
                  onClick={openSms}
                >
                  <MessageSquare className="h-5 w-5 text-sky-600" />
                  SMS
                </button>
              </div>
            </div>
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <Button variant="outline" className="w-full justify-start gap-2" onClick={downloadPdf}>
                <Download className="h-4 w-4" /> Download PDF
              </Button>
              <Button variant="outline" className="w-full justify-start gap-2" onClick={printThermal}>
                <Receipt className="h-4 w-4" /> Thermal receipt
              </Button>
              <Button className="w-full justify-start gap-2" onClick={printA4}>
                <Printer className="h-4 w-4" /> Print A4 (this theme)
              </Button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
