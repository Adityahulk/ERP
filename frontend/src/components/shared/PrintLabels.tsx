import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { X, Printer, Plus, Minus, Eye, Download } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';

interface PrintLabelsProps {
  selectedItems: { item_id: string; sku: string; name: string; quantity: number }[];
  onClose: () => void;
}

export default function PrintLabels({ selectedItems, onClose }: PrintLabelsProps) {
  const [items, setItems] = useState(selectedItems.map(i => ({ ...i, print_qty: i.quantity || 1 })));
  const [mode, setMode] = useState<'general_printer' | 'label_printer'>('general_printer');
  const [generalPreset, setGeneralPreset] = useState<'24' | '40' | '60'>('24');
  const [labelPreset, setLabelPreset] = useState<'single' | 'double'>('single');
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const size: '58x40' | '100x50' | 'a4' = mode === 'general_printer'
    ? 'a4'
    : labelPreset === 'single'
      ? '100x50'
      : '58x40';
  const activeItems = mode === 'label_printer'
    ? items.filter(i => i.print_qty > 0).slice(0, 1)
    : items.filter(i => i.print_qty > 0);
  const totalLabels = activeItems.reduce((acc, i) => acc + i.print_qty, 0);
  const pageInfo = mode === 'general_printer'
    ? `${generalPreset} labels per A4 page`
    : labelPreset === 'single'
      ? '1 label per page'
      : '2 labels per page';

  const buildPayload = () => ({
    mode,
    size,
    labels_per_page: mode === 'general_printer' ? Number(generalPreset) : labelPreset === 'single' ? 1 : 2,
    items: activeItems.map(i => ({ item_id: i.item_id, sku: i.sku, quantity: i.print_qty }))
  });

  const createLabelPdfUrl = async () => {
    const res = await api.post('/labels/bulk', buildPayload(), { responseType: 'blob' });
    return window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
  };

  const handlePreview = async () => {
     try {
       setPreviewLoading(true);
       if (previewUrl) window.URL.revokeObjectURL(previewUrl);
       const url = await createLabelPdfUrl();
       setPreviewUrl(url);
       toast.success(`Preview ready (${pageInfo}).`);
    } catch (e: any) {
      let msg = 'Failed to preview labels.';
      const data = e?.response?.data;
      if (data instanceof Blob) {
        try {
          const txt = await data.text();
          const parsed = JSON.parse(txt);
          msg = parsed?.error || msg;
        } catch {
          // keep default message
        }
      } else if (data?.error) {
        msg = data.error;
      } else if (e?.message) {
        msg = e.message;
      }
      toast.error(msg);
     } finally {
       setPreviewLoading(false);
     }
  };

  const handlePrint = async () => {
     try {
       setLoading(true);
       const url = previewUrl || await createLabelPdfUrl();
       const link = document.createElement('a');
       link.href = url;
       link.setAttribute('download', `labels-${Date.now()}.pdf`);
       document.body.appendChild(link);
       link.click();
       link.remove();
       
       toast.success(`Labels generated (${pageInfo}).`);
       setLoading(false);
    } catch (e: any) {
      setLoading(false);
      let msg = 'Failed to generate labels.';
      const data = e?.response?.data;
      if (data instanceof Blob) {
        try {
          const txt = await data.text();
          const parsed = JSON.parse(txt);
          msg = parsed?.error || msg;
        } catch {
          // keep default message
        }
      } else if (data?.error) {
        msg = data.error;
      } else if (e?.message) {
        msg = e.message;
      }
      toast.error(msg);
     }
  };

  const close = () => {
    if (previewUrl) window.URL.revokeObjectURL(previewUrl);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
       <Card className="w-full max-w-2xl bg-white shadow-xl animate-in zoom-in-95 duration-200">
          <div className="p-4 border-b flex justify-between items-center bg-slate-50 rounded-t-xl">
             <h2 className="text-lg font-bold flex items-center gap-2"><Printer className="w-5 h-5"/> Print Barcode Labels</h2>
             <Button variant="ghost" size="icon" onClick={close}><X className="w-5 h-5"/></Button>
          </div>
          <CardContent className="p-6 space-y-6">
             <div className="grid sm:grid-cols-2 gap-3">
                <button onClick={() => setMode('general_printer')} className={`p-3 border rounded-lg text-left ${mode === 'general_printer' ? 'bg-indigo-50 border-indigo-500 text-indigo-700 font-semibold' : 'hover:bg-slate-50'}`}>
                  General Printer
                  <span className="block text-xs font-normal mt-1 opacity-70">A4 sheets (24 / 40 / 60 labels)</span>
                </button>
                <button onClick={() => setMode('label_printer')} className={`p-3 border rounded-lg text-left ${mode === 'label_printer' ? 'bg-indigo-50 border-indigo-500 text-indigo-700 font-semibold' : 'hover:bg-slate-50'}`}>
                  Label Printer
                  <span className="block text-xs font-normal mt-1 opacity-70">Thermal label roll (1-up / 2-up)</span>
                </button>
             </div>
             <div className="flex gap-4 mb-4 border-b pb-4">
               {mode === 'general_printer' ? (
                 <>
                   <button onClick={() => setGeneralPreset('24')} className={`flex-1 p-3 border rounded-lg text-center ${generalPreset === '24' ? 'bg-indigo-50 border-indigo-500 text-indigo-700 font-semibold' : 'hover:bg-slate-50'}`}>
                     24 / page <span className="block text-xs font-normal mt-1 opacity-70">Larger A4 label</span>
                   </button>
                   <button onClick={() => setGeneralPreset('40')} className={`flex-1 p-3 border rounded-lg text-center ${generalPreset === '40' ? 'bg-indigo-50 border-indigo-500 text-indigo-700 font-semibold' : 'hover:bg-slate-50'}`}>
                     40 / page <span className="block text-xs font-normal mt-1 opacity-70">Medium A4 label</span>
                   </button>
                   <button onClick={() => setGeneralPreset('60')} className={`flex-1 p-3 border rounded-lg text-center ${generalPreset === '60' ? 'bg-indigo-50 border-indigo-500 text-indigo-700 font-semibold' : 'hover:bg-slate-50'}`}>
                     60 / page <span className="block text-xs font-normal mt-1 opacity-70">Small A4 label</span>
                   </button>
                 </>
               ) : (
                 <>
                   <button onClick={() => setLabelPreset('single')} className={`flex-1 p-3 border rounded-lg text-center ${labelPreset === 'single' ? 'bg-indigo-50 border-indigo-500 text-indigo-700 font-semibold' : 'hover:bg-slate-50'}`}>
                     1 / page <span className="block text-xs font-normal mt-1 opacity-70">100×50 mm</span>
                   </button>
                   <button onClick={() => setLabelPreset('double')} className={`flex-1 p-3 border rounded-lg text-center ${labelPreset === 'double' ? 'bg-indigo-50 border-indigo-500 text-indigo-700 font-semibold' : 'hover:bg-slate-50'}`}>
                     2 / page <span className="block text-xs font-normal mt-1 opacity-70">58×40 mm</span>
                   </button>
                 </>
               )}
             </div>
             <p className="text-xs text-slate-500 -mt-3">{pageInfo}{mode === 'label_printer' ? ' • only one item can be printed at a time' : ''}</p>

             <div className="max-h-64 overflow-y-auto space-y-2 border rounded-md p-2">
                 {items.map((item, idx) => {
                   const disabledByMode = mode === 'label_printer' && activeItems[0]?.item_id !== item.item_id;
                   return (
                   <div key={idx} className="flex justify-between items-center p-2 hover:bg-slate-50 rounded">
                      <div>
                         <p className={`font-medium text-sm line-clamp-1 ${disabledByMode ? 'text-slate-400' : 'text-slate-800'}`}>{item.name}</p>
                         <p className="text-xs text-slate-500">{item.sku}</p>
                      </div>
                      <div className="flex items-center gap-3">
                         <button disabled={disabledByMode} onClick={() => { const cp = [...items]; cp[idx].print_qty = Math.max(0, cp[idx].print_qty - 1); setItems(cp) }} className="p-1 rounded bg-slate-100 hover:bg-slate-200 disabled:opacity-40"><Minus className="w-4 h-4"/></button>
                         <span className="w-8 text-center text-sm font-semibold">{item.print_qty}</span>
                         <button disabled={disabledByMode} onClick={() => { const cp = [...items]; cp[idx].print_qty += 1; setItems(cp) }} className="p-1 rounded bg-slate-100 hover:bg-slate-200 disabled:opacity-40"><Plus className="w-4 h-4"/></button>
                      </div>
                    </div>
                   );
                 })}
             </div>

             <div className="flex justify-between items-center pt-2">
                <span className="text-slate-500">Total Labels: <b className="text-slate-900 text-lg">{totalLabels}</b></span>
                <div className="flex gap-2">
                   <Button variant="outline" onClick={close}>Cancel</Button>
                   <Button variant="outline" onClick={handlePreview} disabled={activeItems.length === 0 || previewLoading} className="gap-2">
                      {previewLoading ? <span className="animate-pulse">Preparing...</span> : <><Eye className="w-4 h-4"/> Preview</>}
                   </Button>
                   <Button onClick={handlePrint} disabled={activeItems.length === 0 || loading} className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white">
                      {loading ? <span className="animate-pulse">Generating...</span> : <><Download className="w-4 h-4"/> Download PDF</>}
                   </Button>
                </div>
             </div>
             {previewUrl && (
               <div className="border rounded-lg overflow-hidden bg-slate-100">
                 <iframe title="Barcode label print preview" src={previewUrl} className="w-full h-[420px] bg-white" />
               </div>
             )}
          </CardContent>
       </Card>
    </div>
  );
}
