export async function setImportedGodownStock(
  client: { query: (q: string, p?: any[]) => Promise<{ rows: any[] }> },
  args: { companyId: string; itemId: string; godownId: string; quantity: number; unitCost: number; createdBy: string },
) {
  const current = await client.query(
    `SELECT quantity FROM item_stock WHERE company_id = $1 AND item_id = $2 AND godown_id = $3 FOR UPDATE`,
    [args.companyId, args.itemId, args.godownId],
  );
  const previous = Number(current.rows[0]?.quantity || 0);
  const quantity = Math.round(args.quantity * 10_000) / 10_000;
  const delta = quantity - previous;
  if (delta === 0) return;
  await client.query(
    `INSERT INTO item_stock (company_id, item_id, godown_id, quantity, avg_cost_price)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (item_id, godown_id) DO UPDATE
       SET quantity = EXCLUDED.quantity,
           avg_cost_price = COALESCE(NULLIF(EXCLUDED.avg_cost_price, 0), item_stock.avg_cost_price),
           updated_at = NOW()`,
    [args.companyId, args.itemId, args.godownId, quantity, Math.round(args.unitCost)],
  );
  await client.query(
    `INSERT INTO stock_movements (company_id, item_id, godown_id, movement_type, reference_type, quantity, unit_cost, balance_after, notes, created_by)
     VALUES ($1, $2, $3, 'opening_stock', 'bulk_import', $4, $5, $6, $7, $8)`,
    [args.companyId, args.itemId, args.godownId, delta, Math.round(args.unitCost), quantity, 'Item import: target godown stock set', args.createdBy],
  );
}
