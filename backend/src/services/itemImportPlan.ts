import { importKey, importNumber, importPreviewHash, importRowReader } from './importFile';
import { matchExistingImportItem, type ExistingImportItem } from './itemImportMatch';
import { resolveStockImportGodown, type ImportGodown } from './stockImportGodown';
import { isSafePaise } from '../lib/money';

export const ITEM_IMPORT_HEADERS = ['Name', 'Item Name', 'Product Name', 'Product/Service Name', 'Item/Service Name', 'Name of Item', 'Name of Product', 'Product', 'Item', 'Particulars', 'SKU Name'];
export type ImportClient = { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> };
type Item = ExistingImportItem & { purchase_price: number; selling_price: number; gst_rate: number };
type Serial = { id: string; item_id: string; serial_number: string; status: string; godown_id: string | null; name: string };
export type ItemImportRefs = { items: Item[]; serials: Serial[]; stocks: { item_id: string; godown_id: string; quantity: number; reserved_quantity: number }[]; godowns: ImportGodown[] };
export type ItemImportRecord = {
  row: number; sourceRows: number[]; data: Record<string, any>; warnings: string[];
  action: 'create' | 'stock' | 'serial' | 'transfer' | 'reuse' | 'convert_reference';
};
export type ImportIssue = { row: number; data: Record<string, any>; errors: string[]; resolutionKey?: string; choices?: { value: string; label: string }[] };
export type ItemImportPlan = {
  preview: ItemImportRecord[]; errors: ImportIssue[]; alreadyPresent: { row: number; data: Record<string, any>; message: string }[];
  total: number; valid: number; invalid: number; transfers: number; conversions: number; preview_hash: string; note: string;
};

export async function loadItemImportRefs(client: ImportClient, companyId: string, lock = false): Promise<ItemImportRefs> {
  const items = await client.query(`SELECT id, name, sku, barcode, item_type, track_inventory, is_serialized,
    purchase_price, selling_price, gst_rate, custom_fields FROM items WHERE company_id=$1 AND is_deleted=false ORDER BY id ${lock ? 'FOR UPDATE' : ''}`, [companyId]);
  const serials = await client.query(`SELECT s.id, s.item_id, s.serial_number, s.status, s.godown_id, i.name
    FROM item_serial_numbers s JOIN items i ON i.id=s.item_id AND i.company_id=s.company_id
    WHERE s.company_id=$1 AND i.is_deleted=false ORDER BY s.id ${lock ? 'FOR UPDATE OF s' : ''}`, [companyId]);
  const stocks = await client.query(`SELECT item_id, godown_id, quantity, reserved_quantity FROM item_stock WHERE company_id=$1 ORDER BY item_id, godown_id ${lock ? 'FOR UPDATE' : ''}`, [companyId]);
  const godowns = await client.query(`SELECT id, name, code, is_active FROM godowns WHERE company_id=$1 AND is_deleted=false ORDER BY id ${lock ? 'FOR UPDATE' : ''}`, [companyId]);
  return {
    items: items.rows.map((item) => ({ ...item, stock_godown_ids: stocks.rows.filter((stock) => stock.item_id === item.id).map((stock) => stock.godown_id) })),
    serials: serials.rows, stocks: stocks.rows, godowns: godowns.rows,
  };
}

const resolutionKey = (kind: string, ...values: string[]) => `${kind}:${values.map(encodeURIComponent).join(':')}`;

export function planItemImport(
  rows: Record<string, unknown>[], refs: ItemImportRefs,
  options: { godownId: string; resolutions: Record<string, string>; stockOnly?: boolean },
): ItemImportPlan {
  const preview: ItemImportRecord[] = [];
  const errors: ImportIssue[] = [];
  const alreadyPresent: ItemImportPlan['alreadyPresent'] = [];
  const serialRows = new Map<string, { row: number; quantity: number; godownId: string; details: string }>();
  const bulkReferenceKeys = new Set<string>();
  for (const raw of rows) {
    const get = importRowReader(raw);
    const name = importKey(get(...ITEM_IMPORT_HEADERS));
    const explicit = get('Serial Reference', 'Batch/Serial Reference');
    const number = get('Serial No', 'Serial Number', 'Serial No.', 'S/N');
    const quantity = importNumber(get('Opening Stock', 'Opening Quantity', 'Opening Stock Qty', 'Stock Quantity', 'Current Stock', 'Balance Qty', 'Quantity', 'Qty', 'Stock'));
    if (explicit || (number && quantity > 1)) bulkReferenceKeys.add(`${name}:${importKey(explicit || number)}`);
  }
  const groups = new Map<string, ItemImportRecord>();
  const seenCodes = new Map<string, string>();
  let total = 0;
  for (const [index, raw] of rows.entries()) {
    const get = importRowReader(raw);
    const row = Number(raw.__sourceRow) || index + 2;
    const name = String(get(...ITEM_IMPORT_HEADERS) ?? '').trim();
    let serialNumber = String(get('Serial No', 'Serial Number', 'Serial No.', 'S/N') ?? '').trim();
    const quantityCell = get('Opening Stock', 'Opening Quantity', 'Opening Stock Qty', 'Stock Quantity', 'Current Stock', 'Balance Qty', 'Quantity', 'Qty', 'Stock');
    if (!name && !serialNumber && quantityCell == null && !get('SKU', 'Barcode')) continue;
    total++;
    const quantityText = String(quantityCell ?? '').trim();
    const quantityMatch = quantityText.match(/^(\d+(?:\.\d+)?)\s+([a-zA-Z]+)$/);
    const quantity = Math.round(importNumber(quantityMatch?.[1] ?? quantityCell) * 10_000) / 10_000;
    const knownReference = refs.items.find((item) => importKey(item.name) === importKey(name)
      && serialNumber && importKey(item.custom_fields?.import_serial_reference) === importKey(serialNumber));
    const serialReference = String(get('Serial Reference', 'Batch/Serial Reference') || (quantity > 1 || knownReference || bulkReferenceKeys.has(`${importKey(name)}:${importKey(serialNumber)}`) ? serialNumber : '')).trim();
    if (serialReference) serialNumber = '';
    const priceCell = get('Purchase Price', 'Purchase Rate', 'Cost Price', 'Unit Cost', 'Average Cost', 'Cost');
    const sellingCell = get('Selling Price', 'Sale Price', 'Sales Price', 'Selling Rate', 'Sale Rate', 'Rate', 'Rate per Unit', 'MRP');
    const gstCell = get('GST Rate', 'GST %', 'Tax Rate', 'Tax %');
    const data: Record<string, any> = {
      name, serial_number: serialNumber || null, serial_reference: serialReference || null,
      item_id: String(get('Item ID') ?? '').trim(),
      sku: String(get('SKU', 'Item SKU', 'Product SKU', 'Item Code', 'Product Code', 'Code') ?? '').trim() || null,
      barcode: String(get('Barcode', 'Bar Code', 'Barcode No', 'Barcode Number', 'EAN', 'UPC') ?? '').trim() || null,
      hsn_code: String(get('HSN Code', 'HSN/SAC', 'HSN', 'SAC Code', 'SAC') ?? '').trim() || null,
      brand: String(get('Brand', 'Manufacturer', 'Make') ?? '').trim() || null,
      item_type: String(get('Item Type', 'Type', 'Product Type') || 'product').trim().toLowerCase(),
      opening_stock: quantity,
      purchase_price: Math.round(importNumber(priceCell) * 100),
      selling_price: Math.round(importNumber(sellingCell) * 100),
      gst_rate: importNumber(gstCell), reorder_point: importNumber(get('Reorder Point', 'Reorder Level', 'Minimum Stock', 'Min Stock')),
    };
    const rowErrors: string[] = [];
    const warnings: string[] = [];
    if (!name) rowErrors.push('Item Name is required');
    if (name.length > 500) rowErrors.push('Item Name must be 500 characters or fewer');
    if (!['product', 'service', 'raw_material', 'finished_good', 'consumable'].includes(data.item_type)) rowErrors.push('Item Type is invalid');
    if (!Number.isFinite(quantity) || quantity < 0 || quantity >= 100_000_000_000) rowErrors.push('Quantity must be zero or greater and below 100 billion');
    if (!isSafePaise(data.purchase_price) || data.purchase_price < 0 || !isSafePaise(data.selling_price) || data.selling_price < 0) rowErrors.push('Prices must be non-negative amounts within the supported currency range');
    if (!Number.isFinite(data.gst_rate) || data.gst_rate < 0 || data.gst_rate > 100) rowErrors.push('GST Rate must be between 0 and 100');
    if (!Number.isFinite(data.reorder_point) || data.reorder_point < 0 || data.reorder_point >= 100_000_000_000) rowErrors.push('Reorder Point must be zero or greater and below 100 billion');
    if (serialNumber.length > 200) rowErrors.push('Serial number must be 200 characters or fewer');
    for (const [field, max] of [['sku', 200], ['barcode', 200], ['hsn_code', 20], ['brand', 200]] as const) {
      if (String(data[field] || '').length > max) rowErrors.push(`${field} must be ${max} characters or fewer`);
    }
    if (data.item_type === 'service' && quantity > 0) rowErrors.push('A service cannot have godown stock');
    const target = resolveStockImportGodown(refs.godowns, options.godownId,
      String(get('Godown Name', 'Godown', 'Warehouse') || ''), String(get('Godown Code', 'Warehouse Code') || ''));
    if (target.error && (quantityCell != null || options.stockOnly || serialNumber)) rowErrors.push(target.error);
    data.godown_id = target.godown?.id || '';
    data.godown_name = target.godown?.name || '';
    if (options.stockOnly && quantityCell == null) rowErrors.push('Opening Quantity is required for stock import');
    if (quantityMatch) warnings.push(`Quantity read as ${quantity}; unit ${quantityMatch[2]} is not changed by this import.`);

    const serialKey = resolutionKey('serial', importKey(name), importKey(serialNumber));
    const serialDetails = importPreviewHash({ sku: data.sku, barcode: data.barcode, purchase_price: data.purchase_price, selling_price: data.selling_price, gst_rate: data.gst_rate });
    if (serialNumber && serialRows.has(serialKey)) {
      const first = serialRows.get(serialKey)!;
      if (first.quantity === quantity && first.godownId === data.godown_id && first.details === serialDetails) alreadyPresent.push({ row, data, message: `Repeated serial row; row ${first.row} already includes this unit. It will be counted once.` });
      else errors.push({ row, data, errors: [`Serial number is repeated with different details or a different godown than row ${first.row}. Correct the file before importing this row.`] });
      continue;
    }
    let existing: Item | undefined;
    let existingSerial: Serial | undefined;
    let action: ItemImportRecord['action'] = 'create';
    let issueKey: string | undefined;
    let choices: ImportIssue['choices'];
    if (serialReference) {
      const referenceKey = resolutionKey('reference', importKey(name), importKey(serialReference), data.godown_id);
      const matches = refs.items.filter((item) => importKey(item.name) === importKey(name)
        && importKey(item.custom_fields?.import_serial_reference) === importKey(serialReference));
      const legacy = refs.serials.find((serial) => importKey(serial.name) === importKey(name) && importKey(serial.serial_number) === importKey(serialReference));
      const canConvertLegacy = legacy && !refs.serials.some((serial) => serial.item_id === legacy.item_id &&
        (serial.id !== legacy.id || ['sold', 'reserved'].includes(serial.status)));
      existing = matches.length === 1 ? matches[0] : undefined;
      if (matches.length > 1) rowErrors.push('Multiple legacy records use this reference. Use the Item ID from the branch export.');
      if (data.item_id) {
        existing = refs.items.find((item) => item.id === data.item_id && importKey(item.name) === importKey(name));
        if (!existing || (existing.custom_fields?.import_serial_reference && importKey(existing.custom_fields.import_serial_reference) !== importKey(serialReference))) rowErrors.push('Item ID does not match this item reference');
      }
      if (!existing && legacy) {
        if (options.resolutions[referenceKey] === 'skip') { alreadyPresent.push({ row, data, message: 'Legacy reference left unchanged.' }); continue; }
        if (options.resolutions[referenceKey] === 'bulk_reference' && canConvertLegacy) {
          existing = refs.items.find((item) => item.id === legacy.item_id);
          data.legacy_serial_id = legacy.id;
          action = 'convert_reference';
        } else {
          issueKey = referenceKey;
          choices = [{ value: 'skip', label: 'Keep the existing serial setup' }];
          if (canConvertLegacy) choices.push({ value: 'bulk_reference', label: 'Treat this as a bulk reference and keep all godown quantities' });
          rowErrors.push('This reference was previously marked as a physical serial. Confirm bulk/reference use before importing multiple units.');
        }
      } else if (existing && !existing.is_serialized) action = quantityCell != null ? 'stock' : 'reuse';
      else if (existing?.is_serialized) rowErrors.push('This Item ID is still serial-tracked. Resolve its legacy reference before importing bulk stock.');
      warnings.push(`"${serialReference}" is preserved as an item reference, with quantity ${quantity}. Physical serial tracking is not applied to bulk stock.`);
    } else if (serialNumber) {
      const serialMatches = refs.serials.filter((serial) => importKey(serial.serial_number) === importKey(serialNumber)
        && (data.item_id ? serial.item_id === data.item_id : importKey(serial.name) === importKey(name)));
      existingSerial = serialMatches.length === 1 ? serialMatches[0] : undefined;
      if (serialMatches.length > 1) rowErrors.push('This serial number matches multiple legacy records. Export the branch and use the correct Item ID.');
      if (existingSerial) {
        existing = refs.items.find((item) => item.id === existingSerial!.item_id);
        data.existing_serial_id = existingSerial.id;
        data.serial_status = existingSerial.status;
        data.source_godown_id = existingSerial.godown_id;
        if (['sold', 'reserved'].includes(existingSerial.status)) rowErrors.push(`This serial is ${existingSerial.status}; it cannot be restocked by import. Use the return or reservation workflow.`);
        else if (quantity === 0) {
          action = 'reuse';
          warnings.push('Zero quantity will leave the existing serial unchanged.');
        } else if (existingSerial.status === 'available' && existingSerial.godown_id !== data.godown_id) {
          const source = refs.godowns.find((godown) => godown.id === existingSerial!.godown_id);
          data.source_godown_name = source?.name || 'Unassigned';
          if (options.resolutions[serialKey] === 'transfer') action = 'transfer';
          else if (options.resolutions[serialKey] === 'skip') {
            alreadyPresent.push({ row, data, message: `Left in ${data.source_godown_name}; transfer was not requested.` });
            continue;
          } else {
            issueKey = serialKey;
            choices = [{ value: 'skip', label: `Keep in ${data.source_godown_name}` }];
            if (source) choices.push({ value: 'transfer', label: `Transfer this unit to ${data.godown_name}` });
            rowErrors.push(`This unit is already in ${data.source_godown_name}. Choose whether to keep it there or transfer it.`);
          }
        } else action = 'serial';
      } else if (data.item_id) {
        existing = refs.items.find((item) => item.id === data.item_id && importKey(item.name) === importKey(name));
        if (!existing || !existing.is_serialized) rowErrors.push('Item ID does not identify an existing serial-tracked item with this name');
        else action = 'serial';
      }
    } else {
      const matchKey = resolutionKey('item', importKey(name), data.godown_id);
      if (options.resolutions[matchKey] === 'skip') {
        alreadyPresent.push({ row, data, message: 'Skipped by your selection; no stock will be changed.' });
        continue;
      }
      const matched = matchExistingImportItem(refs.items, data as any, { godownId: data.godown_id, selection: options.resolutions[matchKey] });
      existing = matched.item as Item | undefined;
      if (matched.error) {
        rowErrors.push(matched.error);
        if (matched.candidates) {
          issueKey = matchKey;
          choices = matched.candidates.map((item) => ({ value: item.id, label: `${item.name} | ${item.sku || item.barcode || item.id.slice(0, 8)} | ${refs.stocks.filter((stock) => stock.item_id === item.id).map((stock) => `${refs.godowns.find((godown) => godown.id === stock.godown_id)?.name || 'Godown'}: ${stock.quantity}`).join(', ') || 'No stock yet'}` }));
          if (!options.stockOnly && !data.sku && !data.barcode) choices.push({ value: 'new', label: 'Create a separate unnumbered item' });
          choices.push({ value: 'skip', label: 'Skip these rows' });
        }
      }
      if (existing?.is_serialized) rowErrors.push('For this Item ID/SKU, provide Serial No. To import unnumbered stock, remove the ID/SKU and use the item name.');
      if (existing) action = quantityCell != null && existing.track_inventory ? 'stock' : 'reuse';
    }
    if (existing) {
      data.existing_item_id = existing.id;
      if (priceCell == null) data.purchase_price = Number(existing.purchase_price || 0);
      if (existing.item_type === 'service' || !existing.track_inventory) {
        if (quantity > 0) rowErrors.push('Existing item is not inventory-tracked');
        action = 'reuse';
      }
      const current = refs.stocks.find((stock) => stock.item_id === existing!.id && stock.godown_id === data.godown_id);
      data.before_quantity = Number(current?.quantity || 0);
      data.reserved_quantity = Number(current?.reserved_quantity || 0);
      if (action === 'transfer') {
        const sourceStock = refs.stocks.find((stock) => stock.item_id === existing!.id && stock.godown_id === data.source_godown_id);
        data.source_quantity = Number(sourceStock?.quantity || 0);
        if (data.source_quantity - Number(sourceStock?.reserved_quantity || 0) < 1) rowErrors.push('The source godown has no available unit to transfer; review its stock first');
      }
      warnings.push(action === 'transfer' ? `Moves one unit from ${data.source_godown_name} to ${data.godown_name}.`
        : action === 'stock' ? `Stock in ${data.godown_name}: ${data.before_quantity} → ${quantity}. Other godowns are unchanged.`
        : 'Existing item is reused; its prices and tax settings are kept.');
    } else {
      if (options.stockOnly) rowErrors.push('Item was not found. Import its item master first, or choose an existing item.');
      if (priceCell == null) warnings.push('Missing purchase price is set to 0.');
      if (sellingCell == null) warnings.push('Missing selling price is set to 0.');
      if (gstCell == null) warnings.push('Missing GST rate is set to 0.');
    }
    for (const [field, code] of [['sku', data.sku], ['barcode', data.barcode]] as const) {
      if (!code) continue;
      const owners = refs.items.filter((item) => importKey(item[field]) === importKey(code));
      if (owners.some((item) => item.id !== existing?.id)) rowErrors.push(`${field.toUpperCase()} belongs to a different existing item`);
      const codeKey = `${field}:${importKey(code)}`;
      const identity = existing?.id || `${importKey(name)}:${importKey(serialNumber)}:${importKey(serialReference)}`;
      if (seenCodes.has(codeKey) && seenCodes.get(codeKey) !== identity) rowErrors.push(`${field.toUpperCase()} is used by different items in this file`);
      if (!rowErrors.length) seenCodes.set(codeKey, identity);
    }
    if (rowErrors.length) { errors.push({ row, data, errors: Array.from(new Set(rowErrors)), resolutionKey: issueKey, choices }); continue; }
    if (serialNumber) serialRows.set(serialKey, { row, quantity, godownId: data.godown_id, details: serialDetails });
    const groupKey = `${existing?.id || [importKey(name), importKey(data.sku), importKey(data.barcode), importKey(serialReference)].join(':')}:${data.godown_id}`;
    if (!serialNumber && groups.has(groupKey)) {
      const group = groups.get(groupKey)!;
      if (!existing && (group.data.purchase_price !== data.purchase_price || group.data.selling_price !== data.selling_price || group.data.gst_rate !== data.gst_rate)) {
        errors.push({ row, data, errors: [`Prices/GST differ from row ${group.row} for the same unnumbered item. Use a separate SKU or make the values consistent.`] });
        continue;
      }
      group.data.opening_stock += quantity;
      group.sourceRows.push(row);
      group.warnings = group.warnings.filter((warning) => !warning.startsWith('Combined ') && !warning.startsWith('Stock in '));
      group.warnings.push(`Combined ${group.sourceRows.length} unnumbered rows; target quantity is ${group.data.opening_stock}.`);
    } else {
      const record = { row, sourceRows: [row], data, warnings, action };
      preview.push(record);
      if (!serialNumber) groups.set(groupKey, record);
    }
  }
  for (let index = preview.length - 1; index >= 0; index--) {
    const record = preview[index];
    if ((['stock', 'convert_reference'].includes(record.action) && record.data.opening_stock < record.data.reserved_quantity) ||
        record.data.opening_stock >= 100_000_000_000 || !isSafePaise(Math.round(record.data.opening_stock * record.data.purchase_price))) {
      errors.push({ row: record.row, data: record.data, errors: ['Combined stock must cover reserved units and its value must stay within the supported currency range'] });
      preview.splice(index, 1);
    }
  }
  const result = { preview, errors, alreadyPresent, total, valid: preview.length, invalid: errors.length, transfers: preview.filter((record) => record.action === 'transfer').length,
    conversions: preview.filter((record) => record.action === 'convert_reference').length,
    note: 'Individual serial units, bulk references and unnumbered stock are matched separately. Review the target godown and quantities. Repeated physical serial rows are counted once.' };
  return { ...result, preview_hash: importPreviewHash(result) };
}
