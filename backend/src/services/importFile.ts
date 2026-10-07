import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { createHash } from 'crypto';

export const importKey = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const headerKey = (value: unknown) => importKey(value).replace(/[^a-z0-9]/g, '');

export function importRowReader(row: Record<string, unknown>) {
  const fields = new Map(Object.entries(row).map(([name, value]) => [headerKey(name), value]));
  return (...aliases: string[]) => {
    for (const alias of aliases) {
      const value = fields.get(headerKey(alias));
      if (value != null && String(value).trim() !== '') return value;
    }
    return undefined;
  };
}

export function readImportRows(
  file: Pick<Express.Multer.File, 'path' | 'originalname'>,
  dataset: string,
  requiredHeaders: string[][],
): Record<string, unknown>[] {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === '.json') {
    const body = JSON.parse(fs.readFileSync(file.path, 'utf8'));
    if (body.backup_format) throw new Error('This is a company backup, not an import sheet. Use the Items/Stock export to import branch stock.');
    const data = body?.data ?? body;
    if (!Array.isArray(data) && data.money_unit === 'paise') throw new Error('This JSON stores amounts in paise. Use the Tally bridge for Tally exports or the Excel dataset export for structured imports.');
    const rows = Array.isArray(data) ? data : data?.[dataset];
    if (!Array.isArray(rows)) throw new Error(`JSON must contain an array of ${dataset} records`);
    return rows.filter((row) => row && typeof row === 'object' && !Array.isArray(row))
      .map((row, index) => ({ ...row, __sourceRow: index + 2 }));
  }
  if (!['.csv', '.xls', '.xlsx'].includes(ext)) throw new Error('Choose an XLSX, XLS, CSV or JSON file');
  const book = XLSX.readFile(file.path, { cellDates: false });
  const candidates: Array<{ matrix: unknown[][]; index: number; sheet: string; score: number }> = [];
  for (const sheet of book.SheetNames) {
    if (importKey(sheet) === 'instructions') continue;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[sheet], { header: 1, raw: true, defval: '', blankrows: true });
    for (let index = 0; index < Math.min(30, matrix.length); index++) {
      const headers = new Set(matrix[index].map(headerKey));
      if (requiredHeaders.every((aliases) => aliases.some((alias) => headers.has(headerKey(alias))))) {
        candidates.push({ matrix, index, sheet, score: headers.size + (importKey(sheet).includes(dataset) ? 100 : 0) });
        break;
      }
    }
  }
  const source = candidates.sort((a, b) => b.score - a.score)[0];
  if (!source) throw new Error(`Could not find the ${dataset} header. Required columns: ${requiredHeaders.map((group) => group[0]).join(', ')}.`);
  const headers = source.matrix[source.index].map((cell) => String(cell ?? '').trim());
  return source.matrix.slice(source.index + 1).map((cells, index) => {
    const row: Record<string, unknown> = { __sourceRow: source.index + index + 2 };
    headers.forEach((name, column) => { if (name) row[name] = cells[column] ?? ''; });
    return row;
  }).filter((row) => Object.entries(row).some(([name, value]) => name !== '__sourceRow' && String(value ?? '').trim() !== ''));
}

export function importPreviewHash(result: unknown) {
  return createHash('sha256').update(JSON.stringify(result)).digest('hex');
}

export function importNumber(value: unknown, fallback = 0) {
  if (value == null || String(value).trim() === '') return fallback;
  const number = Number(String(value).replace(/[₹,$%\s]/g, ''));
  return Number.isFinite(number) ? number : NaN;
}
