export type ExistingImportItem = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  item_type: string;
  track_inventory: boolean;
  is_serialized: boolean;
  stock_godown_ids?: string[];
  custom_fields?: Record<string, any>;
};

const key = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

export function matchExistingImportItem(
  items: ExistingImportItem[],
  row: { name: string; sku?: string | null; barcode?: string | null; item_id?: string },
  options: { godownId?: string; selection?: string } = {},
): { item?: ExistingImportItem; error?: string; candidates?: ExistingImportItem[] } {
  const sku = key(row.sku);
  const barcode = key(row.barcode);
  const name = key(row.name);
  if (row.item_id) {
    const item = items.find((candidate) => candidate.id === row.item_id);
    return item && key(item.name) === name ? { item } : { error: 'Item ID was not found in this company or its name does not match' };
  }
  const skuMatch = sku ? items.find((item) => key(item.sku) === sku) : undefined;
  const barcodeMatch = barcode ? items.find((item) => key(item.barcode) === barcode) : undefined;
  if (skuMatch && barcodeMatch && skuMatch.id !== barcodeMatch.id) {
    return { error: 'SKU and barcode identify different existing items' };
  }
  const identified = skuMatch || barcodeMatch;
  if (identified) {
    return key(identified.name) === name
      ? { item: identified }
      : { error: 'Item name does not match the existing SKU or barcode' };
  }
  const nameMatches = items.filter((item) => key(item.name) === name && !item.is_serialized && !item.custom_fields?.import_serial_reference);
  if (options.selection === 'new' && !sku && !barcode) return {};
  if (options.selection) {
    const item = nameMatches.find((candidate) => candidate.id === options.selection);
    return item ? { item } : { error: 'The selected existing item no longer matches this row; review the file again' };
  }
  if (nameMatches.length > 1) {
    const inGodown = nameMatches.filter((item) => options.godownId && item.stock_godown_ids?.includes(options.godownId));
    if (inGodown.length === 1) return { item: inGodown[0] };
    return { error: 'Choose which existing item to stock, or create a separate unnumbered item', candidates: nameMatches };
  }
  if (nameMatches.length === 1) {
    const item = nameMatches[0];
    if (sku && item.sku && key(item.sku) !== sku) return { error: 'SKU differs from the existing item with this name' };
    if (barcode && item.barcode && key(item.barcode) !== barcode) return { error: 'Barcode differs from the existing item with this name' };
    return { item };
  }
  return {};
}
