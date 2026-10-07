export type ExistingImportItem = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  item_type: string;
  track_inventory: boolean;
  is_serialized: boolean;
};

const key = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

export function matchExistingImportItem(
  items: ExistingImportItem[],
  row: { name: string; sku?: string | null; barcode?: string | null },
): { item?: ExistingImportItem; error?: string } {
  const sku = key(row.sku);
  const barcode = key(row.barcode);
  const name = key(row.name);
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
  const nameMatches = items.filter((item) => key(item.name) === name);
  if (nameMatches.length > 1) return { error: 'Multiple existing items have this name; provide a unique SKU or barcode' };
  if (nameMatches.length === 1) {
    const item = nameMatches[0];
    if (sku && item.sku && key(item.sku) !== sku) return { error: 'SKU differs from the existing item with this name' };
    if (barcode && item.barcode && key(item.barcode) !== barcode) return { error: 'Barcode differs from the existing item with this name' };
    return { item };
  }
  return {};
}
