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
  /** Target label format / size.
   *  2 single-label formats + 2 double-label formats + 3 A4 formats */
  printMode: 'a4_24' | 'a4_40' | 'a4_65' | 'thermal_100' | 'thermal_58_double' | 'thermal_50x25';
  barcodeOrientation: 'horizontal' | 'vertical';
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
    line1: createDefaultField('', 'Line 1', 'center'),
    line2: createDefaultField('', 'Line 2', 'center'),
    line3: createDefaultField('', 'Line 3', 'center'),
    line4: createDefaultField('', 'Line 4', 'center'),
    line5: createDefaultField('', 'Line 5', 'center'),
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
    printMode: 'thermal_100',
    barcodeOrientation: 'vertical',
  };
}



/** Maps printMode to the API size/mode/labels_per_page values. */
export function printModeToApiParams(mode: LabelConfig['printMode']): {
  size: '100x50' | '116x40' | '50x25' | 'a4';
  apiMode: 'general_printer' | 'label_printer';
  labelsPerPage: number | undefined;
} {
  switch (mode) {
    case 'a4_24': return { size: 'a4', apiMode: 'general_printer', labelsPerPage: 24 };
    case 'a4_40': return { size: 'a4', apiMode: 'general_printer', labelsPerPage: 40 };
    case 'a4_65': return { size: 'a4', apiMode: 'general_printer', labelsPerPage: 65 };
    case 'thermal_100': return { size: '100x50', apiMode: 'label_printer', labelsPerPage: 1 };
    case 'thermal_58_double': return { size: '116x40', apiMode: 'label_printer', labelsPerPage: 2 };
    case 'thermal_50x25': return { size: '50x25', apiMode: 'label_printer', labelsPerPage: 1 };
  }
}

/** Human-readable label for each print mode. */
export const PRINT_MODE_LABELS: Record<LabelConfig['printMode'], string> = {
  a4_24: 'A4 — 24 labels',
  a4_40: 'A4 — 40 labels',
  a4_65: 'A4 — 65 labels',
  thermal_100: 'Thermal — Single (100×50 mm)',
  thermal_58_double: 'Thermal — 2-up (58×40 mm × 2)',
  thermal_50x25: 'Thermal — Mini (50×25 mm)',
};
