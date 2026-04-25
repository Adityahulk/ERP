import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Cloud } from 'lucide-react';
import toast from 'react-hot-toast';

export default function GSTDashboard() {
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'));
  const [year, setYear] = useState(String(now.getFullYear()));

  const { data } = useQuery({
     queryKey: ['gst', month, year],
     queryFn: async () => (await api.get(`/gst/summary?month=${month}&year=${year}`)).data?.data
  });

  const downloadJson = async (path: string, filename: string) => {
    try {
      const res = await api.get(path);
      const payload = res.data?.data ?? res.data;
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success('Download started');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Download failed');
    }
  };

  const outPaise = (data?.output?.cgst || 0) + (data?.output?.sgst || 0) + (data?.output?.igst || 0);
  const inPaise = (data?.input?.cgst || 0) + (data?.input?.sgst || 0) + (data?.input?.igst || 0);
  const liabPaise = (data?.liability?.cgst || 0) + (data?.liability?.sgst || 0) + (data?.liability?.igst || 0);

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-4">
         <div>
            <h1 className="text-3xl font-bold tracking-tight">GST Compliance Center</h1>
            <p className="text-slate-500 mt-1">Period summaries and JSON exports derived from your ledger (share with your CA).</p>
         </div>
         <div className="flex gap-2 items-center">
            <select className="h-10 rounded-md border bg-white px-2 text-sm" value={month} onChange={(e) => setMonth(e.target.value)}>
               {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => (
                 <option key={m} value={m}>{m}</option>
               ))}
            </select>
            <select className="h-10 rounded-md border bg-white px-2 text-sm" value={year} onChange={(e) => setYear(e.target.value)}>
               {[2023, 2024, 2025, 2026, 2027].map((y) => (
                 <option key={y} value={String(y)}>{y}</option>
               ))}
            </select>
         </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
         <Card className="bg-gradient-to-br from-indigo-50 to-white">
            <CardContent className="p-6">
               <h3 className="text-sm font-medium text-slate-500 mb-1">Total Output Tax (Sales)</h3>
               <div className="text-3xl font-bold text-indigo-700">₹{(outPaise / 100).toFixed(2)}</div>
            </CardContent>
         </Card>
         <Card className="bg-gradient-to-br from-emerald-50 to-white">
            <CardContent className="p-6">
               <h3 className="text-sm font-medium text-slate-500 mb-1">Total ITC Available (Purchases)</h3>
               <div className="text-3xl font-bold text-emerald-700">₹{(inPaise / 100).toFixed(2)}</div>
            </CardContent>
         </Card>
         <Card className="bg-gradient-to-br from-amber-50 to-white">
            <CardContent className="p-6">
               <h3 className="text-sm font-medium text-slate-500 mb-1">Net Tax Liability</h3>
               <div className="text-3xl font-bold text-amber-700">₹{(liabPaise / 100).toFixed(2)}</div>
            </CardContent>
         </Card>
      </div>

      <Card>
         <CardContent className="p-6">
            <h2 className="text-lg font-semibold mb-4 border-b pb-2">JSON exports</h2>
            <div className="space-y-4">
               <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 bg-slate-50 rounded-lg border">
                  <div>
                     <h3 className="font-medium text-slate-900">GSTR-1 style export</h3>
                     <p className="text-sm text-slate-500">B2B / B2CS rows plus filing metadata for reconciliation (not NIC upload format).</p>
                  </div>
                  <Button
                    className="bg-slate-900 shrink-0"
                    type="button"
                    onClick={() => downloadJson(`/gst/gstr1/export?month=${month}&year=${year}`, `gstr1-${year}-${month}.json`)}
                  >
                    <Cloud className="w-4 h-4 mr-2"/> Download JSON
                  </Button>
               </div>
               
               <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 bg-slate-50 rounded-lg border">
                  <div>
                     <h3 className="font-medium text-slate-900">GSTR-3B style export</h3>
                     <p className="text-sm text-slate-500">Outward tax vs ITC aggregates for the selected month.</p>
                  </div>
                  <Button
                    className="bg-slate-900 shrink-0"
                    type="button"
                    onClick={() => downloadJson(`/gst/gstr3b/export?month=${month}&year=${year}`, `gstr3b-${year}-${month}.json`)}
                  >
                    <Cloud className="w-4 h-4 mr-2"/> Download JSON
                  </Button>
               </div>
            </div>
         </CardContent>
      </Card>
    </div>
  );
}
