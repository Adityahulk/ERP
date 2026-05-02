import api from '@/lib/api';
import toast from 'react-hot-toast';

/** Opens the PNG barcode in a new tab using the logged-in session (Bearer token). */
export async function openItemBarcodeInNewTab(itemId: string): Promise<void> {
  try {
    const res = await api.get(`/items/${itemId}/barcode-image`, { responseType: 'blob' });
    const blob = res.data as Blob;
    if (!blob?.size) throw new Error('Empty barcode image');
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank', 'noopener,noreferrer');
    if (!win) toast.error('Pop-up blocked — allow pop-ups for this site to view the barcode');
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
  } catch (e: unknown) {
    const err = e as { response?: { data?: unknown } };
    let msg = 'Could not generate barcode';
    const d = err.response?.data;
    if (d instanceof Blob && d.type === 'application/json') {
      try {
        const j = JSON.parse(await d.text()) as { error?: string };
        if (j?.error) msg = j.error;
      } catch {
        /* ignore */
      }
    } else if (d && typeof d === 'object' && 'error' in (d as object)) {
      msg = String((d as { error?: string }).error || msg);
    }
    toast.error(msg);
  }
}
