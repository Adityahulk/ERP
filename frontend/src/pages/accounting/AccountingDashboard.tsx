import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, ArrowRightLeft, Database, Activity } from 'lucide-react';

export default function AccountingDashboard() {
  const [tab, setTab] = useState('dashboard');
  
  useQuery({
     queryKey: ['trial-balance'],
     queryFn: async () => (await api.get('/accounting/journal-entries')).data?.data
  }); // Using JV endpoint generically to mock activity for the dashboard

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500 max-w-6xl mx-auto">
      <div className="flex justify-between items-center bg-white p-4 rounded-xl border">
         <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">Accounting & Ledgers</h1>
         <div className="flex space-x-2">
            <Button variant="outline" className="gap-2"><Plus className="w-4 h-4"/> New Journal</Button>
         </div>
      </div>

      <div className="flex space-x-2 border-b border-slate-200">
        <button onClick={() => setTab('dashboard')} className={`py-2 px-4 border-b-2 font-medium ${tab === 'dashboard' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500'}`}>Dashboard</button>
        <button onClick={() => setTab('coa')} className={`py-2 px-4 border-b-2 font-medium ${tab === 'coa' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500'}`}>Chart of Accounts</button>
        <button onClick={() => setTab('jv')} className={`py-2 px-4 border-b-2 font-medium ${tab === 'jv' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500'}`}>Journal Entries</button>
        <button onClick={() => setTab('ledger')} className={`py-2 px-4 border-b-2 font-medium ${tab === 'ledger' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500'}`}>Ledger Statements</button>
      </div>

      {tab === 'dashboard' && (
         <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
               <CardContent className="p-6">
                  <h3 className="font-semibold text-slate-700 flex items-center gap-2"><Activity className="w-4 h-4"/> Profit & Loss Snapshot</h3>
                  <div className="mt-4 p-4 bg-slate-50 rounded border space-y-3">
                     <div className="flex justify-between"><span>Revenue</span> <span className="font-medium">₹0.00</span></div>
                     <div className="flex justify-between"><span>Expenses</span> <span className="font-medium text-red-500">₹0.00</span></div>
                     <div className="border-t pt-2 flex justify-between font-bold"><span>Net Profit</span> <span className="text-emerald-600">₹0.00</span></div>
                  </div>
               </CardContent>
            </Card>

            <Card>
               <CardContent className="p-6">
                  <h3 className="font-semibold text-slate-700 flex items-center gap-2"><Database className="w-4 h-4"/> Balance Sheet Snapshot</h3>
                  <div className="mt-4 p-4 bg-slate-50 rounded border space-y-3">
                     <div className="flex justify-between"><span>Total Assets</span> <span className="font-medium text-emerald-600">₹0.00</span></div>
                     <div className="flex justify-between"><span>Total Liabilities</span> <span className="font-medium text-red-500">₹0.00</span></div>
                     <div className="flex justify-between"><span>Total Equity</span> <span className="font-medium text-indigo-600">₹0.00</span></div>
                  </div>
               </CardContent>
            </Card>
         </div>
      )}

      {tab === 'coa' && (
         <Card>
            <CardContent className="p-8 text-center min-h-[300px] flex flex-col justify-center items-center">
               <span className="text-5xl mb-4">🗂️</span>
               <h2 className="text-xl font-bold">Chart of Accounts Management</h2>
               <p className="text-slate-500">Standardizing Assets, Liabilities, Equity, Income, and Expenses structures dynamically connected to your double-entry hooks.</p>
               <Button className="mt-4 bg-indigo-600">Add Account Category</Button>
            </CardContent>
         </Card>
      )}

      {tab === 'jv' && (
         <Card>
            <CardContent className="p-8 text-center min-h-[300px] flex flex-col justify-center items-center">
               <ArrowRightLeft className="w-12 h-12 text-slate-300 mb-4" />
               <h2 className="text-xl font-bold">Manual Journal Entries</h2>
               <p className="text-slate-500">Record depreciation, asset transfers, or complex multiparty adjustments mapping Debits exactly to Credits via JV forms.</p>
               <div className="mt-4 flex gap-4">
                  <Input type="date" className="w-40" />
                  <Button className="bg-slate-900">Load Entries</Button>
               </div>
            </CardContent>
         </Card>
      )}
    </div>
  );
}
