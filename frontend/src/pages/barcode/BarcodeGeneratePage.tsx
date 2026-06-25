import { BarcodeGeneratorPanel } from '@/components/items/BarcodeGeneratorPanel';

export default function BarcodeGeneratePage() {
  return (
    <div className="space-y-6 animate-in fade-in duration-300 max-w-7xl mx-auto p-4 md:p-6 lg:p-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Generate Barcode</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Select items, preview a barcode, and generate A4 or thermal label printer PDFs.
        </p>
      </div>
      <BarcodeGeneratorPanel />
    </div>
  );
}
