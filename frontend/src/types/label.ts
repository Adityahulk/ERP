export type LabelFieldKey =
  | 'brandName'
  | 'line1'
  | 'line2'
  | 'line3'
  | 'line4'
  | 'line5'
  | 'line6'
  | 'barcodeValue';

export interface LabelField {
  value: string;
  type: 'plain' | 'currency';
  style: 'normal' | 'cross' | 'empty';
  format: {
    bold: boolean;
    italic: boolean;
    underline: boolean;
  };
  align?: 'left' | 'center' | 'right';
  placeholder?: string;
}

export interface LabelElement {
  type: 'text' | 'barcode';
  field: LabelFieldKey;

  x: number;
  y: number;

  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  align?: 'left' | 'center' | 'right';

  width?: number;
  height?: number;
}

export interface LabelTemplate {
  id: string;
  name: string;
  type: 'small' | 'big' | 'thermal';

  width: number;
  height: number;

  elements: LabelElement[];
}

export interface LabelData {
  brandName: string;
  line1: LabelField;
  line2: LabelField;
  line3: LabelField;
  line4: LabelField;
  line5: LabelField;
  line6: LabelField;
  price: LabelField;
  currency: 'INR' | 'USD' | 'EUR';
  barcodeValue: string;
  showBarcode: boolean;
  showBarcodeText: boolean;
  barcodeSource: 'system' | 'custom';
  customBarcodeValue: string;
}



