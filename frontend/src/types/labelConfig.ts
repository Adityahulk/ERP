import { LabelField } from './label';

export interface LabelConfig {
  /** Top line — company/brand name. Defaults to logged-in company name. */
  brandName: string;
  /** Free text line 1 — auto-filled with item.name when an item is selected. */
  line1: LabelField;
  /** Free text line 2 — empty string = blank space on the label (not hidden). */
  line2: LabelField;
  /** Free text line 3 — empty string = blank space on the label. */
  line3: LabelField;
  /** Free text line 4 — empty string = blank space on the label. */
  line4: LabelField;
  /** Free text line 5 — empty string = blank space on the label. */
  line5: LabelField;
  /**
   * Free text line 6 — always rendered BOLD + larger font.
   * Empty string = blank bold space on the label.
   * Example use: "50% OFF", "NEW ARRIVAL", "MRP ₹450"
   */
  line6: LabelField;
  price: LabelField;
  /** Currency type for display. */
  currency: 'INR' | 'USD' | 'EUR';
  /** Show barcode toggle. */
  showBarcode: boolean;
  /** Show barcode text toggle. */
  showBarcodeText: boolean;
  barcodeSource: 'system' | 'custom';
  customBarcodeValue: string;
  /** Raw barcode value — auto-filled from item.barcode || item.sku. */
  barcodeValue: string;
  /** Number of label copies to print (1–100). */
  copies: number;
  /** Target label format / size. */
  printMode: 'a4_24' | 'a4_40' | 'a4_65' | 'thermal_single' | 'thermal_double';
}

/** Returns a blank LabelConfig with sensible defaults. */
export function defaultLabelConfig(companyName = ''): LabelConfig {
  const createDefaultField = (val = '', placeholder = '', align: 'left' | 'center' | 'right' = 'left'): LabelField => ({
    value: val,
    type: 'plain',
    style: 'normal',
    format: {
      bold: false,
      italic: false,
      underline: false,
    },
    align,
    placeholder,
  });
  return {
    brandName: companyName,
    line1: createDefaultField('', 'Line 1', 'left'),
    line2: createDefaultField('', 'Line 2', 'left'),
    line3: createDefaultField('', 'Line 3', 'left'),
    line4: createDefaultField('', 'Line 4', 'left'),
    line5: createDefaultField('', 'Line 5', 'left'),
    line6: createDefaultField('', 'Line 6', 'center'),
    price: {
      value: '',
      type: 'currency',
      style: 'normal',
      format: {
        bold: true,
        italic: false,
        underline: false,
      },
      align: 'center',
      placeholder: 'Price',
    },
    currency: 'INR',
    showBarcode: true,
    showBarcodeText: true,
    barcodeSource: 'system',
    customBarcodeValue: '',
    barcodeValue: '',
    copies: 1,
    printMode: 'thermal_single',
  };
}



/** Maps printMode to the API size/mode/labels_per_page values. */
export function printModeToApiParams(mode: LabelConfig['printMode']): {
  size: '58x40' | '100x50' | 'a4';
  apiMode: 'general_printer' | 'label_printer';
  labelsPerPage: number | undefined;
} {
  switch (mode) {
    case 'a4_24': return { size: 'a4', apiMode: 'general_printer', labelsPerPage: 24 };
    case 'a4_40': return { size: 'a4', apiMode: 'general_printer', labelsPerPage: 40 };
    case 'a4_65': return { size: 'a4', apiMode: 'general_printer', labelsPerPage: 65 };
    case 'thermal_single': return { size: '100x50', apiMode: 'label_printer', labelsPerPage: 1 };
    case 'thermal_double': return { size: '58x40', apiMode: 'label_printer', labelsPerPage: 1 };
  }
}

/** Human-readable label for each print mode. */
export const PRINT_MODE_LABELS: Record<LabelConfig['printMode'], string> = {
  a4_24: 'A4 — 24 labels',
  a4_40: 'A4 — 40 labels',
  a4_65: 'A4 — 65 labels',
  thermal_single: 'Thermal — 1 up (100×50 mm)',
  thermal_double: 'Thermal — 1 up (58×40 mm)',
};
