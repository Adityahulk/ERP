import * as XLSX from 'xlsx';

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** UTF-8 BOM so Excel recognises Unicode in CSV. */
export function rowsToCsv(headers: string[], keys: string[], rows: Record<string, unknown>[]): string {
  const head = headers.map(csvEscape).join(',');
  const lines = rows.map((row) => keys.map((k) => csvEscape(row[k])).join(','));
  return '\ufeff' + head + '\n' + lines.join('\n');
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.URL.revokeObjectURL(url);
}

export function downloadCsv(filename: string, headers: string[], keys: string[], rows: Record<string, unknown>[]) {
  const csv = rowsToCsv(headers, keys, rows);
  downloadBlob(filename, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
}

export function downloadXlsx(filename: string, sheetName: string, rows: Record<string, unknown>[]) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31) || 'Report');
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

/** Flatten a shallow object to one CSV row (P&L summary, GSTR-3B summary). */
export function keyValueRows(obj: Record<string, unknown>, prefix = ''): { key: string; value: unknown }[] {
  const out: { key: string; value: unknown }[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      out.push(...keyValueRows(v as Record<string, unknown>, path));
    } else {
      out.push({ key: path, value: v });
    }
  }
  return out;
}
