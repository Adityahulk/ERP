import api from './api';
import toast from 'react-hot-toast';

/**
 * Fetches a PDF from the API and immediately triggers the browser's
 * print dialog, instead of just opening it in a new tab as a preview.
 *
 * Why this exists: every "Print" button in this app used to do
 * `window.open(pdfUrl, '_blank')`, which only opens a preview — the
 * user then has to find the print icon inside the browser's PDF
 * viewer themselves. That's the exact "generates preview but doesn't
 * print" symptom. This fixes the part that's actually fixable from a
 * website: it gets the user straight to the OS print dialog (where
 * their thermal printer shows up as a selectable target) in one step
 * instead of two.
 *
 * What this can NOT do, and why: no browser allows a website to
 * silently print to a specific printer with zero user interaction —
 * that's blocked for security reasons (a malicious site could
 * otherwise print spam to your printer without you knowing). The OS
 * print dialog confirmation step is not a bug in this app; it's a
 * hard browser security boundary. If truly unattended thermal
 * printing is required (e.g. a kiosk), that needs a local print
 * agent — separate software running on that machine with direct
 * printer access — which is a real, separate piece of infrastructure
 * this app does not currently include.
 */
export async function printPdfFromUrl(path: string, params?: Record<string, any>, logLabel = 'print') {
  console.log(`[print] (1/4) requesting PDF — ${logLabel}`, path, params);
  try {
    const res = await api.get(path, { params, responseType: 'blob' });
    console.log(`[print] (2/4) PDF received — ${logLabel}, size=${res.data?.size ?? 0} bytes`);

    const blobUrl = URL.createObjectURL(res.data);
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.src = blobUrl;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('PDF took too long to load for printing')), 15000);
      iframe.onload = () => { clearTimeout(timeout); resolve(); };
      iframe.onerror = () => { clearTimeout(timeout); reject(new Error('Failed to load PDF into print frame')); };
      document.body.appendChild(iframe);
    });

    console.log(`[print] (3/4) PDF loaded into print frame — ${logLabel}. Waiting for the PDF renderer to finish initializing before calling print() (the iframe load event fires on byte-receipt, not on render-complete — calling print() immediately is a known cause of blank/silent prints).`);
    await new Promise((r) => setTimeout(r, 600));

    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    console.log(`[print] (4/4) print() called — ${logLabel}. OS print dialog should now be open; selecting/confirming the printer is a browser security requirement, not something this app can skip.`);

    // Clean up after a delay long enough for the print dialog to have opened.
    setTimeout(() => {
      document.body.removeChild(iframe);
      URL.revokeObjectURL(blobUrl);
    }, 60000);

    return true;
  } catch (err: any) {
    console.error(`[print] FAILED at PDF fetch/load — ${logLabel}:`, err);
    toast.error(err.response?.data?.error || `Could not load the PDF to print (${logLabel}).`);
    return false;
  }
}

/** Same as above, but for a PDF you already have as a Blob (e.g. from
 * an endpoint you needed to call directly for other reasons). */
export function printPdfBlob(blob: Blob, logLabel = 'print') {
  console.log(`[print] (1/3) printing already-fetched blob — ${logLabel}, size=${blob.size} bytes`);
  const blobUrl = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.src = blobUrl;
  iframe.onload = () => {
    console.log(`[print] (2/3) blob loaded into print frame — ${logLabel}. Waiting for the PDF renderer before calling print().`);
    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      console.log(`[print] (3/3) print() called — ${logLabel}.`);
    }, 600);
  };
  document.body.appendChild(iframe);
  setTimeout(() => {
    document.body.removeChild(iframe);
    URL.revokeObjectURL(blobUrl);
  }, 60000);
}
