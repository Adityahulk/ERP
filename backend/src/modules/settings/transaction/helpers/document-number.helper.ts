import { PoolClient } from 'pg';

const TYPE_TABLE: Record<string, { table: string; numberColumn: string; dateColumn?: string }> = {
  sale: { table: 'invoices', numberColumn: 'invoice_number' },
  saleOrder: { table: 'sale_orders', numberColumn: 'order_number' },
  deliveryChallan: { table: 'delivery_challans', numberColumn: 'challan_number' },
  paymentIn: { table: 'payments', numberColumn: 'payment_number' },
};

export async function nextDocumentNumber(client: PoolClient, firmId: string, type: string, prefix: string | null) {
  const cfg = TYPE_TABLE[type];
  if (!cfg) return `${prefix || ''}1`;
  const likePrefix = prefix || '';
  const result = await client.query(
    `SELECT ${cfg.numberColumn} AS doc_no
       FROM ${cfg.table}
      WHERE company_id = $1
        AND COALESCE(${cfg.numberColumn}, '') LIKE $2
      ORDER BY created_at DESC
      LIMIT 200`,
    [firmId, `${likePrefix}%`],
  );
  let max = 0;
  for (const row of result.rows) {
    const n = Number(String(row.doc_no || '').replace(likePrefix, '').match(/\d+$/)?.[0] || 0);
    if (n > max) max = n;
  }
  return `${likePrefix}${max + 1}`;
}
