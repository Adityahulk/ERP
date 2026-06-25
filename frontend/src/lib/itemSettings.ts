export type ItemSettingsState = {
  enable_item: boolean;
  sell_type: 'product' | 'service' | 'both';
  barcode_scan: boolean;
  stock_maintenance: boolean;
  manufacturing: boolean;
  show_low_stock_dialog: boolean;
  items_unit: boolean;
  default_unit: boolean;
  item_category: boolean;
  party_wise_item_rate: boolean;
  description: boolean;
  item_wise_tax: boolean;
  item_wise_discount: boolean;
  update_sale_price_from_transaction: boolean;
  quantity_decimal_places: number;
  wholesale_price: boolean;
  mrp: boolean;
  calculate_tax_based_on_mrp: boolean;
  serial_tracking: boolean;
  batch_tracking: boolean;
  exp_date: boolean;
  mfg_date: boolean;
  model_no: boolean;
  size: boolean;
};

export const DEFAULT_ITEM_SETTINGS: ItemSettingsState = {
  enable_item: true,
  sell_type: 'both',
  barcode_scan: false,
  stock_maintenance: true,
  manufacturing: false,
  show_low_stock_dialog: true,
  items_unit: true,
  default_unit: false,
  item_category: true,
  party_wise_item_rate: false,
  description: false,
  item_wise_tax: true,
  item_wise_discount: true,
  update_sale_price_from_transaction: false,
  quantity_decimal_places: 2,
  wholesale_price: false,
  mrp: false,
  calculate_tax_based_on_mrp: false,
  serial_tracking: false,
  batch_tracking: false,
  exp_date: false,
  mfg_date: false,
  model_no: false,
  size: false,
};

export function normalizeItemSettings(value: unknown): ItemSettingsState {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<ItemSettingsState>
    : {};
  const sellType = raw.sell_type === 'product' || raw.sell_type === 'service' || raw.sell_type === 'both'
    ? raw.sell_type
    : DEFAULT_ITEM_SETTINGS.sell_type;
  return {
    ...DEFAULT_ITEM_SETTINGS,
    ...raw,
    sell_type: sellType,
    quantity_decimal_places: Math.max(0, Math.min(4, Number(raw.quantity_decimal_places ?? DEFAULT_ITEM_SETTINGS.quantity_decimal_places) || 0)),
  };
}

export function itemTypeOptionsForSettings(settings: ItemSettingsState) {
  if (settings.sell_type === 'service') {
    return [{ value: 'service', label: 'Service' }];
  }
  const productOptions = [
    { value: 'product', label: 'Product' },
    { value: 'raw_material', label: 'Raw material' },
    { value: 'finished_good', label: 'Finished good' },
    { value: 'consumable', label: 'Consumable' },
  ];
  return settings.sell_type === 'product'
    ? productOptions
    : [...productOptions, { value: 'service', label: 'Service' }];
}

export function defaultItemTypeForSettings(settings: ItemSettingsState, requested = 'product') {
  const options = itemTypeOptionsForSettings(settings);
  return options.some((entry) => entry.value === requested) ? requested : options[0]?.value || 'product';
}

export function itemSettingExtraFields(settings: ItemSettingsState) {
  return [
    settings.mrp ? { key: 'mrp', label: 'MRP', type: 'number' as const } : null,
    settings.batch_tracking ? { key: 'batch_no', label: 'Batch No.', type: 'text' as const } : null,
    settings.mfg_date ? { key: 'mfg_date', label: 'Mfg Date', type: 'date' as const } : null,
    settings.exp_date ? { key: 'exp_date', label: 'Exp Date', type: 'date' as const } : null,
    settings.model_no ? { key: 'model_no', label: 'Model No.', type: 'text' as const } : null,
    settings.size ? { key: 'size', label: 'Size', type: 'text' as const } : null,
  ].filter(Boolean) as Array<{ key: string; label: string; type: 'text' | 'number' | 'date' }>;
}
