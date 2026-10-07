import { type ImportClient, type ItemImportPlan } from './itemImportPlan';
import { setImportedGodownStock } from './itemImportStock';
import { importKey } from './importFile';
import { calculateOpeningStockValuePaise } from '../lib/stockValuation';

export async function saveItemImportPlan(client: ImportClient, plan: ItemImportPlan, companyId: string, userId: string) {
  let inserted = 0;
  let reused = 0;
  let transferred = 0;
  const created = new Map<string, string>();
  for (const record of plan.preview) {
    const d = record.data;
    const identity = [importKey(d.name), importKey(d.sku), importKey(d.barcode), importKey(d.serial_number), importKey(d.serial_reference)].join(':');
    let itemId: string = d.existing_item_id || created.get(identity);
    const serial = Boolean(d.serial_number);
    const service = d.item_type === 'service';
    if (!itemId) {
      const result = await client.query(
        `INSERT INTO items (company_id, name, sku, barcode, hsn_code, brand, item_type, track_inventory, is_serialized,
          purchase_price, selling_price, gst_rate, cgst_rate, sgst_rate, igst_rate, opening_stock, opening_stock_value, reorder_point, custom_fields)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,$12,$14,$15,$16,$17) RETURNING id`,
        [companyId, d.name, d.sku, d.barcode, d.hsn_code, d.brand, d.item_type, !service, serial,
          d.purchase_price, d.selling_price, d.gst_rate, d.gst_rate / 2, service ? 0 : d.opening_stock,
          service ? 0 : calculateOpeningStockValuePaise(d.opening_stock, d.purchase_price), d.reorder_point,
          JSON.stringify(d.serial_reference ? { import_serial_reference: d.serial_reference } : {})],
      );
      itemId = result.rows[0].id;
      created.set(identity, itemId);
      inserted++;
    } else reused++;
    if (record.action === 'convert_reference') {
      await client.query(`UPDATE items SET is_serialized=false,
        custom_fields=COALESCE(custom_fields,'{}'::jsonb)||$1::jsonb WHERE id=$2 AND company_id=$3`,
        [JSON.stringify({ import_serial_reference: d.serial_reference, import_reference_conversion: {
          serial_id: d.legacy_serial_id, converted_by: userId, converted_at: new Date().toISOString(),
        } }), itemId, companyId]);
      await client.query(`UPDATE item_serial_numbers SET status='unavailable' WHERE id=$1 AND item_id=$2 AND company_id=$3`, [d.legacy_serial_id, itemId, companyId]);
    }
    if (record.action === 'reuse' || service) continue;
    if (!serial) {
      if (d.godown_id) await setImportedGodownStock(client, { companyId, itemId, godownId: d.godown_id,
        quantity: d.opening_stock, unitCost: d.purchase_price, createdBy: userId });
      continue;
    }
    const available = d.opening_stock > 0;
    let serialId = d.existing_serial_id;
    if (!serialId) {
      const result = await client.query(
        `INSERT INTO item_serial_numbers (company_id, item_id, serial_number, status, godown_id)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [companyId, itemId, d.serial_number, available ? 'available' : 'unavailable', available ? d.godown_id : null],
      );
      serialId = result.rows[0].id;
    }
    if (!available) continue;
    const readStock = async (godownId: string) => {
      const stock = await client.query(`SELECT quantity, reserved_quantity FROM item_stock
        WHERE company_id=$1 AND item_id=$2 AND godown_id=$3 FOR UPDATE`, [companyId, itemId, godownId]);
      return { quantity: Number(stock.rows[0]?.quantity || 0), reserved: Number(stock.rows[0]?.reserved_quantity || 0) };
    };
    const target = await readStock(d.godown_id);
    const newlyAvailable = !d.existing_serial_id || d.serial_status !== 'available';
    if (record.action === 'transfer') {
      const source = await readStock(d.source_godown_id);
      if (source.quantity - source.reserved < 1) throw new Error(`Row ${record.row}: source stock is no longer available for transfer`);
      await setImportedGodownStock(client, { companyId, itemId, godownId: d.source_godown_id, quantity: source.quantity - 1,
        unitCost: d.purchase_price, createdBy: userId, movementType: 'transfer_out', notes: `Import transfer of serial ${d.serial_number} to ${d.godown_name}` });
      transferred++;
    }
    await client.query(`UPDATE item_serial_numbers SET status='available', godown_id=$1
      WHERE id=$2 AND item_id=$3 AND company_id=$4`, [d.godown_id, serialId, itemId, companyId]);
    const count = await client.query(`SELECT COUNT(*)::int AS count FROM item_serial_numbers
      WHERE company_id=$1 AND item_id=$2 AND godown_id=$3 AND status='available'`, [companyId, itemId, d.godown_id]);
    const quantity = Math.max(target.quantity + (newlyAvailable || record.action === 'transfer' ? 1 : 0), Number(count.rows[0].count));
    await setImportedGodownStock(client, { companyId, itemId, godownId: d.godown_id, quantity,
      unitCost: d.purchase_price, createdBy: userId, movementType: record.action === 'transfer' ? 'transfer_in' : 'opening_stock',
      notes: `Serial ${d.serial_number} (${record.action === 'transfer' ? 'import transfer' : 'item import'})` });
  }
  return { inserted, reused, transferred, processed: plan.preview.length, skipped: plan.alreadyPresent.length, errors: plan.errors.length };
}
