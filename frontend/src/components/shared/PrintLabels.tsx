import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { X, Printer, Plus, Minus, FileText } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';

interface PrintLabelsProps {
  selectedItems: { item_id: string; sku: string; name: string; quantity: number }[];
  onClose: () => void;
}

export default function PrintLabels({ selectedItems, onClose }: PrintLabelsProps) {
  const [items, setItems] = useState(selectedItems.map(i => ({ ...i, print_qty: i.quantity || 1 })));
  const [size, setSize] = useState<'58x40' | '100x50' | 'a4'>('58x40');
  const [loading, setLoading] = useState(false);

  const totalLabels = items.reduce((acc, i) => acc + i.print_qty, 0);

  const handlePrint = async () => {
     try {
       setLoading(true);
       const payload = {
          size,
          items: items.filter(i => i.print_qty > 0).map(i => ({ item_id: i.item_id, sku: i.sku, quantity: i.print_qty }))
       };
       const res = await api.post('/labels/bulk', payload, { responseType: 'blob' });
       
       const url = window.URL.createObjectURL(new Blob([res.data]));
       const link = document.createElement('a');
       link.href = url;
       link.setAttribute('download', `labels-${Date.now()}.pdf`);
       document.body.appendChild(link);
       link.click();
       link.remove();
       
       toast.success("Labels Generated! Please open the PDF and print.");
       setLoading(false);
       onClose();
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

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
       <Card className="w-full max-w-2xl bg-white shadow-xl animate-in zoom-in-95 duration-200">
          <div className="p-4 border-b flex justify-between items-center bg-slate-50 rounded-t-xl">
             <h2 className="text-lg font-bold flex items-center gap-2"><Printer className="w-5 h-5"/> Print Barcode Labels</h2>
             <Button variant="ghost" size="icon" onClick={onClose}><X className="w-5 h-5"/></Button>
          </div>
          <CardContent className="p-6 space-y-6">
             <div className="flex gap-4 mb-4 border-b pb-4">
                <button onClick={() => setSize('58x40')} className={`flex-1 p-3 border rounded-lg text-center ${size === '58x40' ? 'bg-indigo-50 border-indigo-500 text-indigo-700 font-semibold' : 'hover:bg-slate-50'}`}>
                   58×40mm <span className="block text-xs font-normal mt-1 opacity-70">Retail Standard Shelf Label</span>
                </button>
                <button onClick={() => setSize('100x50')} className={`flex-1 p-3 border rounded-lg text-center ${size === '100x50' ? 'bg-indigo-50 border-indigo-500 text-indigo-700 font-semibold' : 'hover:bg-slate-50'}`}>
                   100×50mm <span className="block text-xs font-normal mt-1 opacity-70">Large Info Label</span>
                </button>
                <button onClick={() => setSize('a4')} className={`flex-1 p-3 border rounded-lg text-center ${size === 'a4' ? 'bg-indigo-50 border-indigo-500 text-indigo-700 font-semibold' : 'hover:bg-slate-50'}`}>
                   A4 Sheet <span className="block text-xs font-normal mt-1 opacity-70">Grid stickers (32/page)</span>
                </button>
             </div>

             <div className="max-h-64 overflow-y-auto space-y-2 border rounded-md p-2">
                {items.map((item, idx) => (
                   <div key={idx} className="flex justify-between items-center p-2 hover:bg-slate-50 rounded">
                      <div>
                         <p className="font-medium text-sm text-slate-800 line-clamp-1">{item.name}</p>
                         <p className="text-xs text-slate-500">{item.sku}</p>
                      </div>
                      <div className="flex items-center gap-3">
                         <button onClick={() => { const cp = [...items]; cp[idx].print_qty = Math.max(0, cp[idx].print_qty - 1); setItems(cp) }} className="p-1 rounded bg-slate-100 hover:bg-slate-200"><Minus className="w-4 h-4"/></button>
                         <span className="w-8 text-center text-sm font-semibold">{item.print_qty}</span>
                         <button onClick={() => { const cp = [...items]; cp[idx].print_qty += 1; setItems(cp) }} className="p-1 rounded bg-slate-100 hover:bg-slate-200"><Plus className="w-4 h-4"/></button>
                      </div>
                   </div>
                ))}
             </div>

             <div className="flex justify-between items-center pt-2">
                <span className="text-slate-500">Total Labels: <b className="text-slate-900 text-lg">{totalLabels}</b></span>
                <div className="flex gap-2">
                   <Button variant="outline" onClick={onClose}>Cancel</Button>
                   <Button onClick={handlePrint} disabled={totalLabels === 0 || loading} className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white">
                      {loading ? <span className="animate-pulse">Generating...</span> : <><FileText className="w-4 h-4"/> Generate PDF</>}
                   </Button>
                </div>
             </div>
          </CardContent>
       </Card>
    </div>
  );
}
