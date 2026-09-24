import { useRef, useState } from 'react';
import {
  Ban, Copy, Download, Edit2, Eye, Mail, MessageCircle, MoreHorizontal,
  Printer, Share2, Trash2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';

type Props = {
  basePath: string;
  documentNumber: string;
  documentTitle: string;
  phone?: string | null;
  email?: string | null;
  canModify?: boolean;
  canCancel?: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onCancel: () => Promise<void>;
  onDelete: () => Promise<void>;
};

function safeFilename(value: string) {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-') || 'document';
}

export default function SalesDocumentActionMenu(props: Props) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const close = () => detailsRef.current?.removeAttribute('open');
  const loadPdf = async () => {
    const response = await api.get(`${props.basePath}/pdf`, { responseType: 'blob', params: { inline: 1 } });
    return new Blob([response.data], { type: 'application/pdf' });
  };
  const run = async (key: string, task: () => Promise<void>) => {
    close();
    setBusy(key);
    try { await task(); } catch (error: any) {
      toast.error(error?.response?.data?.error || error?.message || `${props.documentTitle} action failed`);
    } finally { setBusy(null); }
  };
  const downloadBlob = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${safeFilename(props.documentNumber)}.pdf`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };
  const preview = () => {
    const previewWindow = window.open('', '_blank');
    if (!previewWindow) { toast.error('Allow pop-ups to preview this document.'); return; }
    previewWindow.document.write('<p style="font:14px sans-serif;padding:20px">Preparing preview…</p>');
    void run('preview', async () => {
      const url = URL.createObjectURL(await loadPdf());
      previewWindow.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
    });
  };
  const print = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) { toast.error('Allow pop-ups to print this document.'); return; }
    printWindow.document.write('<p style="font:14px sans-serif;padding:20px">Preparing print…</p>');
    void run('print', async () => {
      const url = URL.createObjectURL(await loadPdf());
      printWindow.location.href = url;
      window.setTimeout(() => { printWindow.focus(); printWindow.print(); }, 900);
      window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
    });
  };
  const shareFile = async (whatsAppOnly = false) => {
    const blob = await loadPdf();
    const file = new File([blob], `${safeFilename(props.documentNumber)}.pdf`, { type: 'application/pdf' });
    const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
    if (navigator.share && (!nav.canShare || nav.canShare({ files: [file] }))) {
      await navigator.share({ title: `${props.documentTitle} ${props.documentNumber}`, text: `${props.documentTitle} ${props.documentNumber}`, files: [file] });
      return;
    }
    downloadBlob(blob);
    if (whatsAppOnly) {
      const phone = String(props.phone || '').replace(/\D/g, '');
      const message = encodeURIComponent(`${props.documentTitle} ${props.documentNumber}. The PDF has been downloaded; please attach it here.`);
      window.open(`https://wa.me/${phone}?text=${message}`, '_blank', 'noopener,noreferrer');
      toast.success('PDF downloaded. Attach it in WhatsApp and send.');
    } else {
      toast.success('PDF downloaded because device sharing is unavailable.');
    }
  };
  const emailDocument = async () => {
    const recipient = window.prompt(`Email ${props.documentTitle} to:`, props.email || '');
    if (!recipient) return;
    await api.post(`${props.basePath}/email`, { email: recipient.trim() });
    toast.success(`${props.documentTitle} emailed successfully`);
  };

  const itemClass = 'flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';
  return (
    <details ref={detailsRef} className="relative inline-block text-left">
      <summary className="inline-flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900" title="Actions" aria-label={`Actions for ${props.documentNumber}`}>
        <MoreHorizontal className="h-4 w-4" />
      </summary>
      <div className="absolute right-0 z-40 mt-1 w-56 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg">
        <button type="button" className={itemClass} onClick={preview} disabled={busy !== null}><Eye className="h-4 w-4" /> Preview</button>
        <button type="button" className={itemClass} onClick={() => void run('download', async () => downloadBlob(await loadPdf()))} disabled={busy !== null}><Download className="h-4 w-4" /> Download PDF</button>
        <button type="button" className={itemClass} onClick={print} disabled={busy !== null}><Printer className="h-4 w-4" /> Print</button>
        <button type="button" className={itemClass} onClick={() => void run('share', () => shareFile(false))} disabled={busy !== null}><Share2 className="h-4 w-4" /> Share</button>
        <button type="button" className={itemClass} onClick={() => void run('whatsapp', () => shareFile(true))} disabled={busy !== null}><MessageCircle className="h-4 w-4 text-emerald-600" /> WhatsApp Share</button>
        <button type="button" className={itemClass} onClick={() => void run('email', emailDocument)} disabled={busy !== null}><Mail className="h-4 w-4" /> Email / Mail</button>
        <div className="my-1 border-t border-slate-100" />
        <button type="button" className={itemClass} onClick={() => { close(); props.onEdit(); }} disabled={!props.canModify}><Edit2 className="h-4 w-4" /> Edit</button>
        <button type="button" className={itemClass} onClick={() => { close(); props.onDuplicate(); }}><Copy className="h-4 w-4" /> Duplicate</button>
        {props.canCancel && <button type="button" className={itemClass} onClick={() => void run('cancel', props.onCancel)}><Ban className="h-4 w-4 text-amber-600" /> Cancel</button>}
        <button type="button" className={`${itemClass} text-red-600 hover:bg-red-50`} onClick={() => void run('delete', props.onDelete)}><Trash2 className="h-4 w-4" /> Delete</button>
      </div>
    </details>
  );
}
