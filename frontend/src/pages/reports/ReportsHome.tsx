import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, Filter, FileText } from 'lucide-react';

const reportCategories = [
  { id: 'gst', title: 'GST Reports', reports: ['GSTR-1 Data', 'GSTR-3B Summary', 'HSN Summary', 'Input Tax Credit'] },
  { id: 'sales', title: 'Sales Reports', reports: ['Sales Register', 'Item-wise Sales', 'Party-wise Sales', 'Outstanding Receivables'] },
  { id: 'purchase', title: 'Purchase Reports', reports: ['Purchase Register', 'Party-wise Purchase', 'Outstanding Payables'] },
  { id: 'inventory', title: 'Inventory Reports', reports: ['Stock Summary', 'Stock Movement', 'Low Stock Alert'] },
  { id: 'financial', title: 'Financial Reports', reports: ['Profit & Loss', 'Balance Sheet', 'Trial Balance', 'Day Book'] }
];

export default function ReportsHome() {
  const [activeReport, setActiveReport] = useState('Sales Register');

  return (
    <div className="flex h-[calc(100vh-theme(spacing.16))] bg-slate-50/50 animate-in slide-in-from-bottom-4 duration-500">
       <div className="w-64 border-r bg-white p-4 overflow-y-auto hidden md:block">
          <h2 className="text-xl font-bold mb-6 text-slate-800 tracking-tight">Report Center</h2>
          {reportCategories.map(cat => (
             <div key={cat.id} className="mb-6">
                <h3 className="text-xs font-semibold uppercase text-slate-500 tracking-wider mb-3">{cat.title}</h3>
                <div className="space-y-1">
                   {cat.reports.map(r => (
                      <button 
                        key={r}
                        onClick={() => setActiveReport(r)}
                        className={`w-full text-left px-3 py-2 text-sm rounded-md transition-colors ${activeReport === r ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
                      >
                         {r}
                      </button>
                   ))}
                </div>
             </div>
          ))}
       </div>

       <div className="flex-1 flex flex-col min-w-0">
          <div className="h-16 border-b flex items-center justify-between px-6 bg-white shrink-0">
             <h1 className="text-xl font-semibold flex items-center gap-2"><FileText className="w-5 h-5 text-indigo-500"/> {activeReport}</h1>
             <div className="flex gap-2">
                <Button variant="outline" size="sm"><Filter className="w-4 h-4 mr-2" /> Filters</Button>
                <Button variant="outline" size="sm"><Download className="w-4 h-4 mr-2" /> Export CSV</Button>
                <Button variant="outline" size="sm" className="bg-green-50 text-green-700 border-green-200 hover:bg-green-100"><Download className="w-4 h-4 mr-2" /> Excel</Button>
             </div>
          </div>
          
          <div className="flex-1 p-6 overflow-y-auto">
             {/* Report Viewer Sandbox */}
             <Card>
                <CardContent className="p-8 text-center text-slate-500 min-h-[400px] flex flex-col items-center justify-center">
                   <FileText className="w-12 h-12 text-slate-200 mb-4" />
                   <h3 className="text-lg font-medium text-slate-700 mb-2">Displaying {activeReport}</h3>
                   <p className="text-sm">Select dates and filters above to generate data vectors.</p>
                </CardContent>
             </Card>
          </div>
       </div>
    </div>
  );
}
