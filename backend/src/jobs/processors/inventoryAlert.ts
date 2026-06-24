import { Job } from 'bullmq';
import { query } from '../../config/db';
import { sendWhatsApp } from '../../services/notificationService';
import { withJobRunTracking } from '../jobRunTracking';

export async function processInventoryAlert(job: Job) {
  return withJobRunTracking(job, async () => {
    const { companyId } = job.data;

    const companyRes = await query(`SELECT name, phone FROM companies WHERE id = $1 AND is_deleted = false`, [companyId]);
    const company = companyRes.rows[0];
    if (!company?.phone) {
      return { alertsSent: 0, note: 'No company phone number on file — nothing to notify' };
    }

    // Same low-stock definition as the existing /reports/low-stock endpoint:
    // items with track_inventory on, below their reorder point.
    const lowStock = await query(
      `SELECT i.id, i.name, i.sku, i.reorder_point, i.unit,
              COALESCE(SUM(s.quantity), 0) AS total_qty
       FROM items i
       LEFT JOIN item_stock s ON s.item_id = i.id AND s.company_id = i.company_id
       WHERE i.company_id = $1 AND i.is_deleted = false AND i.track_inventory = true
         AND i.reorder_point > 0
       GROUP BY i.id, i.name, i.sku, i.reorder_point, i.unit
       HAVING COALESCE(SUM(s.quantity), 0) <= i.reorder_point
       ORDER BY i.name
       LIMIT 20`,
      [companyId],
    );

    let sent = 0;
    for (const item of lowStock.rows) {
      await sendWhatsApp(company.phone, 'LOW_STOCK_ALERT', {
        company_name: company.name,
        item_name: item.name,
        sku: item.sku || '—',
        quantity: item.total_qty,
        unit: item.unit || 'units',
        reorder_point: item.reorder_point,
      }, companyId);
      sent++;
    }

    return { lowStockItems: lowStock.rows.length, alertsSent: sent };
  });
}
