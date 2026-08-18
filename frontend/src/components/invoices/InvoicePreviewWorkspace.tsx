import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Download, Printer, Receipt, Send, Mail, MessageSquare } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { formatMoney, formatDate } from '@/lib/formatters';
import toast from 'react-hot-toast';
import { PRINT_LAYOUT_OPTIONS, PRINT_LAYOUT_LEGACY_ID_MAP, type PrintLayoutId } from '@/components/settings/PrintLayoutPreview';
import { LEGACY_STORAGE_KEYS, readStorageWithLegacy, removeStorageWithLegacy, STORAGE_KEYS } from '@/lib/storageKeys';
import { apiErrorMessage } from '@/lib/blobError';
import { printPdfBlob } from '@/lib/printPdf';

const SKIP_PREVIEW_KEY = STORAGE_KEYS.skipInvoicePreview;
const LEGACY_SKIP_PREVIEW_KEY = LEGACY_STORAGE_KEYS.skipInvoicePreview;

export const INVOICE_PDF_TEMPLATES = PRINT_LAYOUT_OPTIONS.map((layout) => ({
  ...layout,
  tip: `${layout.group} invoice layout`,
})) as Array<(typeof PRINT_LAYOUT_OPTIONS)[number] & { tip: string }>;

export type InvoicePdfTemplateId = PrintLayoutId;
export const DOCUMENT_THEME_OPTIONS = INVOICE_PDF_TEMPLATES;
export type DocumentThemeId = PrintLayoutId;

type TemplateRow = (typeof INVOICE_PDF_TEMPLATES)[number];

export const LEGACY_INVOICE_THEME_MAP: Record<string, InvoicePdfTemplateId> = {
  ...PRINT_LAYOUT_LEGACY_ID_MAP,
};

export function normalizeInvoiceThemeId(value: unknown, fallback: InvoicePdfTemplateId = 'business-theme-1'): InvoicePdfTemplateId {
  const raw = String(value || '').trim();
  if (PRINT_LAYOUT_OPTIONS.some((theme) => theme.id === raw)) return raw as InvoicePdfTemplateId;
  return LEGACY_INVOICE_THEME_MAP[raw] || fallback;
}

export type InvoicePreviewDraftPayload = {
  invoice_type: string;
  pdf_template?: string;
  document_theme?: string;
  party_id?: string;
  party_name?: string;
  godown_id?: string;
  invoice_date: string;
  due_date?: string;
  is_interstate: boolean;
  place_of_supply?: string;
  shipping_address?: string;
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
  return false;
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
  const [template, setTemplate] = useState<InvoicePdfTemplateId>('business-theme-1');
  const [savedTheme, setSavedTheme] = useState<InvoicePdfTemplateId>('business-theme-1');
  const [printSettingsLoaded, setPrintSettingsLoaded] = useState(false);
  const [savingTheme, setSavingTheme] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [loading, setLoading] = useState(false);
  const [waSending, setWaSending] = useState(false);
  const [sharePhone, setSharePhone] = useState(partyPhone || '');
  const previewRequestSeq = useRef(0);

  useEffect(() => {
    setSharePhone(partyPhone || '');
  }, [partyPhone, open]);

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

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPrintSettingsLoaded(false);
    api.get('/settings/print')
      .then((response) => {
        if (cancelled) return;
        const settings = response.data?.data ?? response.data ?? {};
        const nextTheme = normalizeInvoiceThemeId(draftPayload?.pdf_template || draftPayload?.document_theme || settings.invoiceTheme || settings.regular?.layout || settings.invoice_theme);
        setSavedTheme(nextTheme);
        setTemplate(nextTheme);
      })
      .catch(() => {
        if (cancelled) return;
        setSavedTheme('business-theme-1');
        setTemplate('business-theme-1');
      })
      .finally(() => {
        if (!cancelled) setPrintSettingsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [draftPayload?.document_theme, draftPayload?.pdf_template, open]);

  const loadPdf = useCallback(async () => {
    if (!open || !printSettingsLoaded) return;
    const seq = previewRequestSeq.current + 1;
    previewRequestSeq.current = seq;
    const previewKey = `${Date.now()}-${seq}`;
    setLoading(true);
    setPdfBlob(null);
    setPdfUrl((prev) => {
      revoke(prev);
      return null;
    });
    try {
      let blob: Blob;
      if (mode === 'saved' && invoiceId) {
        const res = await api.get(`/invoices/${invoiceId}/pdf`, {
          params: { theme: template, inline: 1, preview_key: previewKey },
          responseType: 'blob',
        });
        blob = res.data as Blob;
      } else if (mode === 'draft' && draftPayload) {
        const res = await api.post('/invoices/preview-pdf', { ...draftPayload, theme: template, preview_key: previewKey }, { responseType: 'blob' });
        blob = res.data as Blob;
      } else {
        return;
      }
      if (seq !== previewRequestSeq.current) return;
      setPdfBlob(blob);
      setPdfUrl((prev) => {
        revoke(prev);
        return window.URL.createObjectURL(blob);
      });
    } catch (e: any) {
      if (seq === previewRequestSeq.current) {
        toast.error(await apiErrorMessage(e, 'Could not load preview'));
      }
    } finally {
      if (seq === previewRequestSeq.current) setLoading(false);
    }
  }, [open, printSettingsLoaded, mode, invoiceId, draftPayload, template, revoke]);

  useEffect(() => {
    if (!open) return;
    loadPdf();
  }, [open, loadPdf]);

  useEffect(() => {
    return () => {
      previewRequestSeq.current += 1;
      setPdfUrl((prev) => {
        revoke(prev);
        return null;
      });
      setPdfBlob(null);
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
    const previewKey = `${Date.now()}-export-${template}`;
    if (mode === 'saved' && invoiceId) {
      const res = await api.get(`/invoices/${invoiceId}/pdf`, {
        params: { theme: template, inline: 1, preview_key: previewKey },
        responseType: 'blob',
      });
      blob = res.data as Blob;
    } else if (mode === 'draft' && draftPayload) {
      const res = await api.post('/invoices/preview-pdf', { ...draftPayload, theme: template, preview_key: previewKey }, { responseType: 'blob' });
      blob = res.data as Blob;
    } else {
      throw new Error('Nothing to share');
    }
    const safeName = `${shareContext.invoiceNumber.replace(/\//g, '-')}.pdf`;
    return new File([blob], safeName, { type: 'application/pdf' });
  };

  const openWhatsApp = async (target: 'web' | 'app') => {
    const phone = normalizePhone(sharePhone);
    if (!phone) {
      toast.error('Enter a mobile number to share on WhatsApp.');
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
      toast.error(await apiErrorMessage(e, 'Download failed'), { id: t });
    }
  };

  const printA4 = async () => {
    if (!pdfBlob) {
      toast.error('The invoice preview is still loading.');
      return;
    }
    const t = toast.loading('Opening print dialog…');
    try {
      await printPdfBlob(pdfBlob, { direct: false });
      toast.success('Print dialog opened', { id: t });
    } catch (e: any) {
      toast.error(e?.message || 'Could not print invoice', { id: t });
    }
  };

  const printThermal = async () => {
    const id = invoiceIdForPrint || invoiceId;
    if (!id) {
      toast.error('Save the invoice first to print a thermal receipt.');
      return;
    }
    const w = readStorageWithLegacy(STORAGE_KEYS.printerType, LEGACY_STORAGE_KEYS.printerType) === 'thermal58' ? '58' : '80';
    const t = toast.loading('Opening receipt…');
    try {
      const res = await api.get(`/print/receipt/${id}`, { params: { width: w }, responseType: 'blob' });
      const receipt = new Blob([res.data], { type: 'application/pdf' });
      try {
        const mode = await printPdfBlob(receipt);
        toast.success(mode === 'direct' ? 'Receipt sent to printer' : 'Print dialog opened', { id: t });
      } catch {
        await printPdfBlob(receipt, { direct: false });
        toast.success('Print dialog opened', { id: t });
      }
    } catch (e: any) {
      toast.error(await apiErrorMessage(e, 'Print failed'), { id: t });
    }
  };

  const openGmail = () => {
    const subject = encodeURIComponent(`Invoice ${shareContext.invoiceNumber}`);
    const body = encodeURIComponent(buildWaMessage());
    window.open(`https://mail.google.com/mail/?view=cm&fs=1&su=${subject}&body=${body}`, '_blank', 'noopener,noreferrer');
  };

  const openSms = () => {
    const phone = normalizePhone(sharePhone);
    const body = encodeURIComponent(buildWaMessage());
    const href = phone ? `sms:${phone}?&body=${body}` : `sms:?&body=${body}`;
    window.location.href = href;
  };

  const handleSaveClose = async () => {
    setSavingTheme(true);
    try {
      await api.put('/settings/print', { invoiceTheme: template });
      setSavedTheme(template);
      removeStorageWithLegacy(SKIP_PREVIEW_KEY, LEGACY_SKIP_PREVIEW_KEY);
      toast.success('Default invoice theme saved');
      onClose();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Could not save theme');
    } finally {
      setSavingTheme(false);
    }
  };

  const handleDismiss = () => {
    setTemplate(savedTheme);
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
          </div>
          <div className="p-3 border-t border-slate-200 text-[11px] text-slate-500 leading-snug bg-white">
            Selecting a theme here saves it as your default.
          </div>
        </aside>

        {/* Preview */}
        <div className="flex-1 flex flex-col min-w-0 bg-slate-100">
          <header className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-slate-200 bg-white shrink-0">
            <h2 className="text-sm font-semibold text-slate-800 mr-auto">Preview</h2>
            <Button size="sm" onClick={handleSaveClose} loading={savingTheme}>
              Save &amp; close
            </Button>
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={handleDismiss} aria-label="Close preview">
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
              <input
                value={sharePhone}
                onChange={(e) => setSharePhone(e.target.value)}
                placeholder="Mobile number"
                className="mb-2 h-9 w-full rounded-md border border-emerald-200 bg-white px-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-emerald-300"
              />
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
