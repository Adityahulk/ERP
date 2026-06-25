import { Job } from 'bullmq';
import fs from 'fs';
import path from 'path';
import { query } from '../../config/db';
import { env } from '../../config/env';
import { withJobRunTracking } from '../jobRunTracking';

const BACKUP_TABLES: { table: string; key: string }[] = [
  { table: 'parties', key: 'parties' },
  { table: 'items', key: 'items' },
  { table: 'invoices', key: 'invoices' },
  { table: 'invoice_items', key: 'invoice_items' },
  { table: 'purchase_invoices', key: 'purchase_invoices' },
  { table: 'purchase_invoice_items', key: 'purchase_invoice_items' },
  { table: 'payments', key: 'payments' },
  { table: 'expenses', key: 'expenses' },
];

export async function processAutoBackup(job: Job) {
  return withJobRunTracking(job, async () => {
    const { companyId } = job.data;

    const backup: Record<string, any[]> = { _meta: [{ companyId, exportedAt: new Date().toISOString() }] as any };
    let totalRows = 0;

    for (const { table, key } of BACKUP_TABLES) {
      // invoice_items / purchase_invoice_items don't have company_id directly
      // — scope them via their parent table to stay multi-tenant safe.
      const rows = table === 'invoice_items'
        ? await query(`SELECT ii.* FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE i.company_id = $1`, [companyId])
        : table === 'purchase_invoice_items'
          ? await query(`SELECT pii.* FROM purchase_invoice_items pii JOIN purchase_invoices pi ON pi.id = pii.purchase_invoice_id WHERE pi.company_id = $1`, [companyId])
          : await query(`SELECT * FROM ${table} WHERE company_id = $1`, [companyId]);
      backup[key] = rows.rows;
      totalRows += rows.rows.length;
    }

    const dir = path.resolve(env.UPLOAD_DIR, 'backups', companyId);
    fs.mkdirSync(dir, { recursive: true });
    const filename = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, JSON.stringify(backup, null, 2), 'utf8');

    // Keep only the 14 most recent backups per company so this doesn't
    // grow disk usage unbounded.
    const existing = fs.readdirSync(dir).filter((f) => f.startsWith('backup-')).sort();
    for (const old of existing.slice(0, Math.max(0, existing.length - 14))) {
      fs.unlinkSync(path.join(dir, old));
    }

    return { filePath, totalRows, tables: BACKUP_TABLES.map((t) => t.key) };
  });
}
