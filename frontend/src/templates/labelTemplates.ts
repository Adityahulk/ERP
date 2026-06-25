import { LabelTemplate } from '@/types';

// Only the Price Highlight template is used. All others have been removed.
export const TEMPLATES: LabelTemplate[] = [
  {
    id: 'price',
    name: 'Price Highlight',
    type: 'big',
    width: 220,
    height: 140,
    elements: [
      { type: 'text', field: 'line1', x: 10, y: 10, fontSize: 16, fontWeight: 'bold' },
      { type: 'text', field: 'line6', x: 10, y: 40, fontSize: 24, fontWeight: 'bold' },
      { type: 'barcode', field: 'barcodeValue', x: 10, y: 80, width: 200, height: 50 }
    ]
  },
];
