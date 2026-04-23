import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Cloud } from 'lucide-react';

export default function GSTDashboard() {
  const [month] = useState('04');
  const [year] = useState('2023');

  const { data } = useQuery({
     queryKey: ['gst', month, year],
     queryFn: async () => (await api.get(`/gst/summary?month=${month}&year=${year}`)).data?.data
  });

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500 max-w-6xl mx-auto">
      <div className="flex justify-between items-center">
         <div>
            <h1 className="text-3xl font-bold tracking-tight">GST Compliance Center</h1>
            <p className="text-slate-500 mt-1">GSTR-1, 2A, and 3B outputs for direct portal injection.</p>
         </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
         <Card className="bg-gradient-to-br from-indigo-50 to-white">
            <CardContent className="p-6">
               <h3 className="text-sm font-medium text-slate-500 mb-1">Total Output Tax (Sales)</h3>
               <div className="text-3xl font-bold text-indigo-700">₹{((data?.output?.cgst||0 + data?.output?.sgst||0 + data?.output?.igst||0) / 100).toFixed(2)}</div>
            </CardContent>
         </Card>
         <Card className="bg-gradient-to-br from-emerald-50 to-white">
            <CardContent className="p-6">
               <h3 className="text-sm font-medium text-slate-500 mb-1">Total ITC Available (Purchases)</h3>
               <div className="text-3xl font-bold text-emerald-700">₹{((data?.input?.cgst||0 + data?.input?.sgst||0 + data?.input?.igst||0) / 100).toFixed(2)}</div>
            </CardContent>
         </Card>
         <Card className="bg-gradient-to-br from-amber-50 to-white">
            <CardContent className="p-6">
               <h3 className="text-sm font-medium text-slate-500 mb-1">Net Tax Liability</h3>
               <div className="text-3xl font-bold text-amber-700">₹{((data?.liability?.cgst||0 + data?.liability?.sgst||0 + data?.liability?.igst||0) / 100).toFixed(2)}</div>
            </CardContent>
         </Card>
      </div>

      <Card>
         <CardContent className="p-6">
            <h2 className="text-lg font-semibold mb-4 border-b pb-2">Offline Utility JSON Exporters</h2>
            <div className="space-y-4">
               <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border">
                  <div>
                    <h3 className="font-medium text-slate-900">GSTR-1 Data Package</h3>
                    <p className="text-sm text-slate-500">Includes B2B, B2CS, and HSN Summaries structured for NIC validation.</p>
                  </div>
                  <Button className="bg-slate-900"><Cloud className="w-4 h-4 mr-2"/> Download JSON</Button>
               </div>
               
               <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border">
                  <div>
                    <h3 className="font-medium text-slate-900">GSTR-3B Summary</h3>
                    <p className="text-sm text-slate-500">Aggregate ITC and Output metrics for final filing offset.</p>
                  </div>
                  <Button className="bg-slate-900"><Cloud className="w-4 h-4 mr-2"/> Download JSON</Button>
               </div>
            </div>
         </CardContent>
      </Card>
    </div>
  );
}
