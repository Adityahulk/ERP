import { TEMPLATES } from '@/templates/labelTemplates';
import { LabelTemplate, LabelData } from '@/types';
import { LabelRenderer } from './LabelRenderer';

interface TemplatePickerProps {
  selectedTemplateId: string;
  onSelect: (template: LabelTemplate) => void;
}

export function TemplatePicker({ selectedTemplateId, onSelect }: TemplatePickerProps) {
  // Sample dummy data to display in the mini preview
  const previewData: LabelData = {
    brandName: 'MY BRAND',
    line1: { value: 'Sample Product Name', type: 'plain', style: 'normal', format: { bold: true, italic: false, underline: false }, align: 'left', placeholder: 'Line 1' },
    line2: { value: 'Variant: 500g', type: 'plain', style: 'normal', format: { bold: false, italic: false, underline: false }, align: 'left', placeholder: 'Line 2' },
    line3: { value: 'Batch: B-101', type: 'plain', style: 'normal', format: { bold: false, italic: false, underline: false }, align: 'left', placeholder: 'Line 3' },
    line4: { value: 'Mfg: June 2026', type: 'plain', style: 'normal', format: { bold: false, italic: false, underline: false }, align: 'left', placeholder: 'Line 4' },
    line5: { value: 'Exp: Dec 2026', type: 'plain', style: 'normal', format: { bold: false, italic: false, underline: false }, align: 'left', placeholder: 'Line 5' },
    line6: { value: 'Discount 10%', type: 'plain', style: 'normal', format: { bold: false, italic: true, underline: false }, align: 'center', placeholder: 'Line 6' },
    price: { value: '499.00', type: 'currency', style: 'normal', format: { bold: true, italic: false, underline: false }, align: 'center', placeholder: 'Price' },
    barcodeValue: 'SC|COMPANY|ITEM',
    currency: 'INR',
    showBarcode: true,
    showBarcodeText: true,
    barcodeSource: 'system',
    customBarcodeValue: ''
  };



  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {TEMPLATES.map((t) => {
        const isSelected = t.id === selectedTemplateId;
        return (
          <div
            key={t.id}
            onClick={() => onSelect(t)}
            className={`cursor-pointer rounded-xl border-2 p-3 transition-all duration-200 flex flex-col items-center gap-3 bg-white shadow-sm hover:shadow-md ${
              isSelected
                ? 'border-indigo-600 ring-2 ring-indigo-600/20'
                : 'border-slate-200 hover:border-indigo-300'
            }`}
          >
            <div className="flex flex-col items-center text-center">
              <span className="font-semibold text-sm text-slate-800">{t.name}</span>
              <span className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">
                {t.type} ({t.width}x{t.height} px)
              </span>
            </div>

            {/* Mini scaled preview container */}
            <div className="w-full h-32 flex items-center justify-center bg-slate-50 border rounded-lg overflow-hidden relative p-2">
              <div
                style={{
                  transform: `scale(${Math.min(150 / t.width, 90 / t.height)})`,
                  transformOrigin: 'center',
                  flexShrink: 0
                }}
              >
                <LabelRenderer template={t} data={previewData} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
