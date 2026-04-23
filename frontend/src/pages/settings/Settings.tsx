import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/authStore';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Building2, MapPin, Users, FileText, Package, Database, AlertCircle, Upload, Power } from 'lucide-react';
import toast from 'react-hot-toast';
import { Navigate } from 'react-router-dom';
import { useCompany, useUpdateCompany } from '@/hooks/useBusiness';
import api from '@/lib/api';

export default function Settings() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'super_admin' || user?.role === 'company_admin';
  const { data: company, isLoading: companyLoading } = useCompany();
  const updateCompany = useUpdateCompany();

  const [einvEnabled, setEinvEnabled] = useState(false);
  const [einvTurnover, setEinvTurnover] = useState(false);
  const [einvSandbox, setEinvSandbox] = useState(true);
  const [einvUser, setEinvUser] = useState('');
  const [einvPass, setEinvPass] = useState('');
  const [printerType, setPrinterType] = useState<'a4' | 'thermal80' | 'thermal58'>('a4');

  if (!isAdmin) {
     return <Navigate to="/dashboard" replace />;
  }

  const [tab, setTab] = useState('company');

  // Stub states
  const [deleteConf, setDeleteConf] = useState('');

  useEffect(() => {
    if (!company) return;
    setEinvEnabled(!!company.einvoice_enabled);
    setEinvTurnover(!!company.einvoice_turnover_above_5cr);
    setEinvSandbox(company.einvoice_sandbox !== false);
    setEinvUser(company.einvoice_gsp_username || '');
    const saved = localStorage.getItem('bizflow_printer_type') as 'a4' | 'thermal80' | 'thermal58' | null;
    if (saved === 'thermal80' || saved === 'thermal58' || saved === 'a4') setPrinterType(saved);
  }, [company]);

  const saveEinvoice = async () => {
    try {
      await updateCompany.mutateAsync({
        einvoice_enabled: einvEnabled,
        einvoice_turnover_above_5cr: einvTurnover,
        einvoice_sandbox: einvSandbox,
        einvoice_gsp_username: einvUser || null,
        ...(einvPass ? { einvoice_gsp_password: einvPass } : {}),
      });
      setEinvPass('');
      toast.success('e-Invoice settings saved');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Save failed');
    }
  };

  const savePrinter = () => {
    localStorage.setItem('bizflow_printer_type', printerType);
    toast.success('Printer preference saved');
  };

  const testPrint = async () => {
    try {
      const res = await api.get('/invoices', { params: { page: 1, limit: 1 } });
      const page = res.data?.data;
      const first = page?.data?.[0];
      if (!first?.id) {
        toast.error('No invoice found for sample print');
        return;
      }
      const w = printerType === 'thermal58' ? '58' : '80';
      const pdfRes = await api.get(`/print/receipt/${first.id}`, { params: { width: w }, responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([pdfRes.data], { type: 'application/pdf' }));
      window.open(url, '_blank');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Test print failed');
    }
  };

  const TABS = [
     { id: 'company', label: 'Company Profile', icon: Building2 },
     { id: 'godowns', label: 'Locations / Godowns', icon: MapPin },
     { id: 'users', label: 'Users & Roles', icon: Users },
     { id: 'invoices', label: 'Invoice Settings', icon: FileText },
     { id: 'items', label: 'Item Configuration', icon: Package },
     { id: 'data', label: 'Data Management', icon: Database },
     { id: 'danger', label: 'Danger Zone', icon: AlertCircle, error: true },
  ];

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 animate-in slide-in-from-bottom-4 duration-500">
      <div className="mb-6">
         <h1 className="text-2xl font-bold text-slate-900">Platform Settings</h1>
         <p className="text-slate-500 text-sm">Manage enterprise parameters, users, and core configurations.</p>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
         {/* Navigation Sidebar */}
         <div className="md:w-64 shrink-0 flex flex-col gap-1">
            {TABS.map(t => (
               <button 
                  key={t.id} 
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                     tab === t.id 
                       ? t.error ? 'bg-red-50 text-red-700' : 'bg-indigo-50 text-indigo-700' 
                       : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
               >
                  <t.icon className={`w-4 h-4 ${tab === t.id && t.error ? 'text-red-600' : tab === t.id ? 'text-indigo-600' : 'text-slate-400'}`} /> 
                  {t.label}
               </button>
            ))}
         </div>

         {/* Content Area */}
         <div className="flex-1">
            <Card className="min-h-[500px]">
               {tab === 'company' && (
                  <CardContent className="p-6 space-y-6">
                     <h2 className="text-xl font-bold mb-4">Company Profile</h2>
                     {companyLoading && <p className="text-sm text-muted-foreground">Loading company…</p>}
                     <div className="grid md:grid-cols-2 gap-6 border-b pb-6">
                        <div>
                           <label className="text-sm font-medium text-slate-700 block mb-2">Company Status</label>
                           <div className="flex items-center gap-4">
                              <div className="w-24 h-24 bg-slate-100 rounded-lg border-2 border-dashed flex flex-col items-center justify-center text-slate-400 cursor-pointer hover:bg-slate-50">
                                 <Upload className="w-6 h-6 mb-1"/> <span className="text-[10px] uppercase">Logo</span>
                              </div>
                              <div className="w-32 h-24 bg-slate-100 rounded-lg border-2 border-dashed flex flex-col items-center justify-center text-slate-400 cursor-pointer hover:bg-slate-50">
                                 <Upload className="w-6 h-6 mb-1"/> <span className="text-[10px] uppercase">Stamp/Sign</span>
                              </div>
                           </div>
                        </div>
                        <div className="space-y-4">
                           <div>
                              <label className="text-sm font-medium text-slate-700">Legal Name</label>
                              <Input defaultValue="BizFlow Demo Entity" className="mt-1" />
                           </div>
                           <div>
                              <label className="text-sm font-medium text-slate-700">GSTIN</label>
                              <Input defaultValue="27AABCU9603R1ZN" className="mt-1" />
                           </div>
                        </div>
                     </div>

                     <div className="grid md:grid-cols-2 gap-6">
                        <div className="space-y-4">
                           <h3 className="font-semibold text-slate-900">Banking Details</h3>
                           <Input placeholder="Bank Name" defaultValue="HDFC Bank" />
                           <Input placeholder="Account Number" defaultValue="50200045612398" />
                           <Input placeholder="IFSC Code" defaultValue="HDFC0001234" />
                        </div>
                        <div className="space-y-4">
                           <h3 className="font-semibold text-slate-900">UPI Context</h3>
                           <Input placeholder="UPI ID (e.g. upi@hdfcbank)" defaultValue="bizflow@upi" />
                           <p className="text-xs text-slate-500">QR Code will be dynamically generated on the invoice PDF based on total payload requirements automatically.</p>
                        </div>
                     </div>
                     <div className="pt-4"><Button>Save Profile</Button></div>

                     <div className="border-t pt-8 space-y-4">
                        <h3 className="font-semibold text-slate-900">e-Invoice (GST / NIC)</h3>
                        <p className="text-xs text-slate-500">GSP password is encrypted at rest. Leave password blank to keep the current secret.</p>
                        <div className="flex items-center justify-between gap-4 max-w-md">
                           <span className="text-sm">Enable e-Invoice</span>
                           <Switch checked={einvEnabled} onCheckedChange={setEinvEnabled} />
                        </div>
                        <div className="flex items-center justify-between gap-4 max-w-md">
                           <span className="text-sm">Turnover above ₹5 Cr (mandatory threshold)</span>
                           <Switch checked={einvTurnover} onCheckedChange={setEinvTurnover} />
                        </div>
                        <div className="flex items-center justify-between gap-4 max-w-md">
                           <span className="text-sm">Sandbox mode</span>
                           <Switch checked={einvSandbox} onCheckedChange={setEinvSandbox} />
                        </div>
                        <div className="grid md:grid-cols-2 gap-4 max-w-xl">
                           <div>
                              <label className="text-sm font-medium text-slate-700">GSP username</label>
                              <Input className="mt-1" value={einvUser} onChange={(e) => setEinvUser(e.target.value)} />
                           </div>
                           <div>
                              <label className="text-sm font-medium text-slate-700">GSP password</label>
                              <Input type="password" className="mt-1" value={einvPass} onChange={(e) => setEinvPass(e.target.value)} placeholder={company?.has_einvoice_gsp_password ? '••••••••' : ''} />
                           </div>
                        </div>
                        <Button onClick={saveEinvoice} disabled={updateCompany.isPending}>Save e-Invoice settings</Button>
                     </div>
                  </CardContent>
               )}

               {tab === 'users' && (
                  <CardContent className="p-6">
                     <div className="flex justify-between items-center mb-6">
                        <h2 className="text-xl font-bold">Users & Roles</h2>
                        <Button className="gap-2"><Users className="w-4 h-4"/> Invite User</Button>
                     </div>
                     <div className="border rounded-lg overflow-hidden">
                        <table className="w-full text-sm text-left">
                           <thead className="bg-slate-50 border-b">
                              <tr>
                                 <th className="px-4 py-3 font-semibold text-slate-600">Employee</th>
                                 <th className="px-4 py-3 font-semibold text-slate-600">Role</th>
                                 <th className="px-4 py-3 font-semibold text-slate-600">Location</th>
                                 <th className="px-4 py-3 font-semibold text-slate-600">Status</th>
                                 <th className="px-4 py-3 font-semibold text-right">Actions</th>
                              </tr>
                           </thead>
                           <tbody className="divide-y">
                              <tr className="hover:bg-slate-50/50">
                                 <td className="px-4 py-3"><p className="font-semibold text-slate-900">{user?.name}</p><p className="text-xs text-slate-500">{user?.email}</p></td>
                                 <td className="px-4 py-3"><span className="bg-indigo-100 text-indigo-700 px-2 py-1 rounded text-xs font-bold uppercase">{user?.role}</span></td>
                                 <td className="px-4 py-3">Main Godown</td>
                                 <td className="px-4 py-3"><span className="text-emerald-600 font-medium text-xs">Active Now</span></td>
                                 <td className="px-4 py-3 text-right"><Button variant="ghost" size="sm">Manage</Button></td>
                              </tr>
                           </tbody>
                        </table>
                     </div>
                  </CardContent>
               )}

               {tab === 'godowns' && (
                  <CardContent className="p-6">
                     <div className="flex justify-between items-center mb-6">
                        <h2 className="text-xl font-bold">Godowns & Warehouses</h2>
                        <Button variant="outline" className="gap-2"><MapPin className="w-4 h-4"/> Add Godown</Button>
                     </div>
                     <div className="grid gap-4">
                        <div className="p-4 border rounded-lg flex items-center justify-between hover:border-indigo-300 transition-colors bg-slate-50/50">
                           <div className="flex gap-4 items-center">
                              <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-lg flex items-center justify-center font-bold">G1</div>
                              <div>
                                 <p className="font-semibold text-slate-900">Main Warehouse</p>
                                 <p className="text-xs text-slate-500">Andheri East, Mumbai • Handled by {user?.name}</p>
                              </div>
                           </div>
                           <Button variant="ghost" size="sm">Edit</Button>
                        </div>
                     </div>
                  </CardContent>
               )}

               {tab === 'invoices' && (
                  <CardContent className="p-6 space-y-6">
                     <h2 className="text-xl font-bold">Invoice Configuration</h2>
                     <div className="space-y-4">
                        <div>
                           <label className="text-sm font-medium text-slate-700">Invoice Prefix Sequence</label>
                           <Input defaultValue="INV/MUM/" className="mt-1 max-w-xs font-mono" />
                           <p className="text-xs text-slate-500 mt-1">Example output: INV/MUM/25-26/0001</p>
                        </div>
                        <div>
                           <label className="text-sm font-medium text-slate-700">Default Terms & Conditions</label>
                           <textarea className="w-full mt-1 border rounded-md p-3 h-32 text-sm" defaultValue="1. Goods once sold will not be taken back.\n2. Subject to Mumbai Jurisdiction.\n3. Interest @ 18% p.a. will be charged if payment is delayed."/>
                        </div>
                        <div className="border-t pt-6 space-y-3 max-w-md">
                           <h3 className="font-semibold">Printer</h3>
                           <label className="text-sm font-medium text-slate-700">Printer type</label>
                           <select
                              className="mt-1 w-full h-10 rounded-md border bg-white px-3 text-sm"
                              value={printerType}
                              onChange={(e) => setPrinterType(e.target.value as typeof printerType)}
                           >
                              <option value="a4">A4 Laser</option>
                              <option value="thermal80">80mm Thermal</option>
                              <option value="thermal58">58mm Thermal</option>
                           </select>
                           <div className="flex gap-2">
                              <Button type="button" variant="outline" onClick={savePrinter}>Save printer preference</Button>
                              <Button type="button" variant="secondary" onClick={testPrint}>Test print</Button>
                           </div>
                           <p className="text-xs text-slate-500">Saved in this browser (localStorage). POS uses it after checkout.</p>
                        </div>
                        <Button>Save Preferences</Button>
                     </div>
                  </CardContent>
               )}

               {tab === 'items' && (
                  <CardContent className="p-6 space-y-6">
                     <h2 className="text-xl font-bold">Item & Vocabulary Schema</h2>
                     <div className="p-4 bg-blue-50 border border-blue-100 rounded-lg text-blue-800 text-sm">
                        <p className="font-semibold mb-1">Domain Translation Active</p>
                        BizFlow automatically translates UI text based on your domain setup.
                     </div>
                     <div className="grid grid-cols-2 gap-4 max-w-lg">
                        <div>
                           <label className="text-sm font-medium text-slate-700">Default Item Name</label>
                           <select className="w-full mt-1 h-10 border rounded px-3 bg-white">
                              <option>Item</option>
                              <option>Product</option>
                              <option>Part</option>
                              <option>Medicine</option>
                           </select>
                        </div>
                        <div>
                           <label className="text-sm font-medium text-slate-700">Primary Default GST %</label>
                           <select className="w-full mt-1 h-10 border rounded px-3 bg-white">
                              <option value="18">18% Standard</option>
                              <option value="12">12%</option>
                              <option value="5">5%</option>
                              <option value="0">0%</option>
                           </select>
                        </div>
                     </div>
                     <Button className="mt-4">Apply Schema</Button>
                  </CardContent>
               )}

               {tab === 'data' && (
                  <CardContent className="p-6 space-y-6">
                     <h2 className="text-xl font-bold">Data Management Flow</h2>
                     <div className="grid md:grid-cols-2 gap-6">
                        <Card className="border-indigo-100 shadow-sm">
                           <CardContent className="p-6 flex flex-col items-center text-center">
                              <div className="w-12 h-12 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-600 mb-3"><Upload className="w-6 h-6"/></div>
                              <h3 className="font-bold text-slate-900 mb-1">Import Legacy Data</h3>
                              <p className="text-sm text-slate-500 mb-4">Upload Item Masters or Customer ledgers via structured CSV.</p>
                              <Button variant="outline" className="w-full">Upload CSV</Button>
                           </CardContent>
                        </Card>
                        <Card className="border-emerald-100 shadow-sm">
                           <CardContent className="p-6 flex flex-col items-center text-center">
                              <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-600 mb-3"><Database className="w-6 h-6"/></div>
                              <h3 className="font-bold text-slate-900 mb-1">Export JSON / Tally DB</h3>
                              <p className="text-sm text-slate-500 mb-4">Push localized records to universal schemas.</p>
                              <Button variant="outline" className="w-full border-emerald-600 text-emerald-700">Dump Data</Button>
                           </CardContent>
                        </Card>
                     </div>
                  </CardContent>
               )}

               {tab === 'danger' && (
                  <CardContent className="p-6 space-y-6">
                     <div className="flex items-center gap-2 text-red-600 mb-2">
                        <AlertCircle className="w-6 h-6"/>
                        <h2 className="text-xl font-bold">Danger Zone</h2>
                     </div>
                     <p className="text-slate-600 text-sm max-w-xl">
                        Deleting this company will permanently destroy all underlying Invoices, Purchases, Leave Matrices, Godown logic, and User profiles. **This physical cascade cannot be stopped**.
                     </p>
                     
                     <div className="bg-red-50 p-6 rounded-lg border border-red-200 mt-6 max-w-xl">
                        <h3 className="font-semibold text-red-900 mb-2">Are you fully sure?</h3>
                        <p className="text-sm text-red-700 mb-4">Please type <strong>DELETE-MY-COMPANY</strong> to confirm.</p>
                        <Input value={deleteConf} onChange={e => setDeleteConf(e.target.value)} className="border-red-300 focus-visible:ring-red-500 mb-4 bg-white" />
                        <Button 
                           variant="destructive" 
                           disabled={deleteConf !== 'DELETE-MY-COMPANY'}
                           className="w-full gap-2"
                           onClick={() => toast.error("System physically locked to prevent deletion during demo.")}
                        >
                           <Power className="w-4 h-4"/> Nuke Workspace
                        </Button>
                     </div>
                  </CardContent>
               )}
            </Card>
         </div>
      </div>
    </div>
  );
}
