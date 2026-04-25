import { useState, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  const qc = useQueryClient();
  const isAdmin = user?.role === 'super_admin' || user?.role === 'company_admin';
  const { data: company, isLoading: companyLoading } = useCompany();
  const updateCompany = useUpdateCompany();

  const [einvEnabled, setEinvEnabled] = useState(false);
  const [einvTurnover, setEinvTurnover] = useState(false);
  const [einvSandbox, setEinvSandbox] = useState(true);
  const [einvUser, setEinvUser] = useState('');
  const [einvPass, setEinvPass] = useState('');
  const [printerType, setPrinterType] = useState<'a4' | 'thermal80' | 'thermal58'>('a4');
  const [legalName, setLegalName] = useState('');
  const [gstin, setGstin] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [bankIfsc, setBankIfsc] = useState('');
  const [upiId, setUpiId] = useState('');
  const [invoicePrefix, setInvoicePrefix] = useState('');
  const [invoiceTerms, setInvoiceTerms] = useState('');
  const [itemTerminologySingular, setItemTerminologySingular] = useState('Item');
  const [itemTerminologyPlural, setItemTerminologyPlural] = useState('Items');
  const [defaultGstRate, setDefaultGstRate] = useState('18');
  const [newUser, setNewUser] = useState({ name: '', email: '', phone: '', role: 'staff', password: '' });
  const [newGodown, setNewGodown] = useState({ name: '', code: '', city: '', state: '', is_default: false });
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingGodownId, setEditingGodownId] = useState<string | null>(null);
  const [editUserForm, setEditUserForm] = useState({ name: '', email: '', phone: '', role: 'staff', is_active: true });
  const [editGodownForm, setEditGodownForm] = useState({ name: '', code: '', city: '', state: '', is_default: false, is_active: true });
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);

  if (!isAdmin) {
     return <Navigate to="/dashboard" replace />;
  }

  const [tab, setTab] = useState('company');

  // Stub states
  const [deleteConf, setDeleteConf] = useState('');

  const { data: usersPage, isLoading: usersLoading } = useQuery({
    queryKey: ['settings-users'],
    queryFn: () => api.get('/users', { params: { page: 1, limit: 50 } }).then((r) => r.data?.data ?? r.data),
  });
  const users = (usersPage as any)?.data ?? [];

  const { data: godownsData, isLoading: godownsLoading } = useQuery({
    queryKey: ['settings-godowns'],
    queryFn: () => api.get('/godowns').then((r) => r.data?.data ?? r.data),
  });
  const godownRows = (godownsData as any) ?? [];

  const createUser = useMutation({
    mutationFn: () => api.post('/users', newUser),
    onSuccess: () => {
      toast.success('User invited');
      setNewUser({ name: '', email: '', phone: '', role: 'staff', password: '' });
      qc.invalidateQueries({ queryKey: ['settings-users'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Invite failed'),
  });

  const updateUser = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => api.patch(`/users/${id}`, data),
    onSuccess: () => {
      toast.success('User updated');
      setEditingUserId(null);
      qc.invalidateQueries({ queryKey: ['settings-users'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Update failed'),
  });

  const createGodown = useMutation({
    mutationFn: () => api.post('/godowns', newGodown),
    onSuccess: () => {
      toast.success('Godown added');
      setNewGodown({ name: '', code: '', city: '', state: '', is_default: false });
      qc.invalidateQueries({ queryKey: ['settings-godowns'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Add failed'),
  });

  const updateGodown = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => api.patch(`/godowns/${id}`, data),
    onSuccess: () => {
      toast.success('Godown updated');
      setEditingGodownId(null);
      qc.invalidateQueries({ queryKey: ['settings-godowns'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Update failed'),
  });

  const openEditUser = (u: any) => {
    setEditingUserId(u.id);
    setEditUserForm({
      name: u.name || '',
      email: u.email || '',
      phone: u.phone || '',
      role: u.role || 'staff',
      is_active: !!u.is_active,
    });
  };

  const openEditGodown = (g: any) => {
    setEditingGodownId(g.id);
    setEditGodownForm({
      name: g.name || '',
      code: g.code || '',
      city: g.city || '',
      state: g.state || '',
      is_default: !!g.is_default,
      is_active: !!g.is_active,
    });
  };

  const downloadItemsTemplate = async () => {
    try {
      const res = await api.get('/items/import-template', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'bizflow_item_import_template.xlsx';
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Template download failed');
    }
  };

  const uploadImportFile = async (file?: File) => {
    if (!file) return;
    try {
      setImporting(true);
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post('/items/bulk-import?action=confirm', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const d = res.data?.data ?? res.data;
      toast.success(`Import complete. Inserted ${d.inserted || 0} items`);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Import failed');
    } finally {
      setImporting(false);
      if (importFileRef.current) importFileRef.current.value = '';
    }
  };

  const dumpData = async () => {
    try {
      const [companyRes, itemsRes, partiesRes, invoicesRes, godownsRes, usersRes] = await Promise.all([
        api.get('/company'),
        api.get('/items', { params: { page: 1, limit: 5000 } }),
        api.get('/parties', { params: { page: 1, limit: 5000 } }),
        api.get('/invoices', { params: { page: 1, limit: 5000 } }),
        api.get('/godowns'),
        api.get('/users', { params: { page: 1, limit: 5000 } }),
      ]);
      const dump = {
        generated_at: new Date().toISOString(),
        company: companyRes.data?.data ?? companyRes.data,
        items: (itemsRes.data?.data ?? itemsRes.data)?.data ?? [],
        parties: (partiesRes.data?.data ?? partiesRes.data)?.data ?? [],
        invoices: (invoicesRes.data?.data ?? invoicesRes.data)?.data ?? [],
        godowns: godownsRes.data?.data ?? godownsRes.data,
        users: (usersRes.data?.data ?? usersRes.data)?.data ?? [],
      };
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bizflow-data-dump-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success('Data dump downloaded');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Export failed');
    }
  };

  useEffect(() => {
    if (!company) return;
    setEinvEnabled(!!company.einvoice_enabled);
    setEinvTurnover(!!company.einvoice_turnover_above_5cr);
    setEinvSandbox(company.einvoice_sandbox !== false);
    setEinvUser(company.einvoice_gsp_username || '');
    const saved = localStorage.getItem('bizflow_printer_type') as 'a4' | 'thermal80' | 'thermal58' | null;
    if (saved === 'thermal80' || saved === 'thermal58' || saved === 'a4') setPrinterType(saved);
    setLegalName(company.legal_name || company.name || '');
    setGstin(company.gstin || '');
    setBankName(company.bank_name || '');
    setBankAccountNumber(company.bank_account_number || '');
    setBankIfsc(company.bank_ifsc || '');
    setUpiId(company.upi_id || '');
    setInvoicePrefix(company.invoice_prefix || 'INV');
    setInvoiceTerms(company.terms_and_conditions || '');
    setItemTerminologySingular(company.item_terminology || 'Item');
    setItemTerminologyPlural(company.item_terminology_plural || 'Items');
    setDefaultGstRate(String(company.default_gst_rate ?? 18));
  }, [company]);

  const saveProfile = async () => {
    try {
      await updateCompany.mutateAsync({
        legal_name: legalName.trim() || null,
        gstin: gstin.trim().toUpperCase() || null,
        bank_name: bankName.trim() || null,
        bank_account_number: bankAccountNumber.trim() || null,
        bank_ifsc: bankIfsc.trim().toUpperCase() || null,
        upi_id: upiId.trim() || null,
      });
      toast.success('Company profile updated');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Save failed');
    }
  };

  const saveInvoicePreferences = async () => {
    try {
      await updateCompany.mutateAsync({
        invoice_prefix: invoicePrefix.trim() || 'INV',
        terms_and_conditions: invoiceTerms.trim() || null,
      });
      toast.success('Invoice preferences saved');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Save failed');
    }
  };

  const applyItemSchema = async () => {
    try {
      await updateCompany.mutateAsync({
        item_terminology: itemTerminologySingular,
        item_terminology_plural: itemTerminologyPlural,
        default_gst_rate: Number(defaultGstRate) || 0,
      });
      toast.success('Item schema applied');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Apply failed');
    }
  };

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
                             <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} className="mt-1" />
                           </div>
                           <div>
                              <label className="text-sm font-medium text-slate-700">GSTIN</label>
                             <Input value={gstin} onChange={(e) => setGstin(e.target.value)} className="mt-1 uppercase" />
                           </div>
                        </div>
                     </div>

                     <div className="grid md:grid-cols-2 gap-6">
                        <div className="space-y-4">
                           <h3 className="font-semibold text-slate-900">Banking Details</h3>
                          <Input placeholder="Bank Name" value={bankName} onChange={(e) => setBankName(e.target.value)} />
                          <Input placeholder="Account Number" value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} />
                          <Input placeholder="IFSC Code" className="uppercase" value={bankIfsc} onChange={(e) => setBankIfsc(e.target.value)} />
                        </div>
                        <div className="space-y-4">
                           <h3 className="font-semibold text-slate-900">UPI Context</h3>
                          <Input placeholder="UPI ID (e.g. upi@hdfcbank)" value={upiId} onChange={(e) => setUpiId(e.target.value)} />
                           <p className="text-xs text-slate-500">QR Code will be dynamically generated on the invoice PDF based on total payload requirements automatically.</p>
                        </div>
                     </div>
                    <div className="pt-4"><Button onClick={saveProfile} disabled={updateCompany.isPending}>Save Profile</Button></div>

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
                        <Button className="gap-2" onClick={() => setEditingUserId('new')}><Users className="w-4 h-4"/> Invite User</Button>
                     </div>
                     {editingUserId === 'new' && (
                        <div className="mb-4 rounded-lg border p-4 grid md:grid-cols-5 gap-3">
                           <Input placeholder="Name" value={newUser.name} onChange={(e) => setNewUser((s) => ({ ...s, name: e.target.value }))} />
                           <Input placeholder="Email" value={newUser.email} onChange={(e) => setNewUser((s) => ({ ...s, email: e.target.value }))} />
                           <Input placeholder="Phone" value={newUser.phone} onChange={(e) => setNewUser((s) => ({ ...s, phone: e.target.value }))} />
                           <select className="h-10 rounded-md border bg-white px-3 text-sm" value={newUser.role} onChange={(e) => setNewUser((s) => ({ ...s, role: e.target.value }))}>
                              <option value="staff">staff</option><option value="cashier">cashier</option><option value="manager">manager</option><option value="accountant">accountant</option><option value="company_admin">company_admin</option>
                           </select>
                           <Input type="password" placeholder="Password" value={newUser.password} onChange={(e) => setNewUser((s) => ({ ...s, password: e.target.value }))} />
                           <div className="md:col-span-5 flex gap-2">
                              <Button onClick={() => createUser.mutate()} disabled={!newUser.name || !newUser.password || createUser.isPending}>Create User</Button>
                              <Button variant="outline" onClick={() => setEditingUserId(null)}>Cancel</Button>
                           </div>
                        </div>
                     )}
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
                              {usersLoading && (
                                <tr><td className="px-4 py-3 text-muted-foreground" colSpan={5}>Loading users…</td></tr>
                              )}
                              {users.map((u: any) => (
                                <tr key={u.id} className="hover:bg-slate-50/50">
                                  <td className="px-4 py-3"><p className="font-semibold text-slate-900">{u.name}</p><p className="text-xs text-slate-500">{u.email || '—'}</p></td>
                                  <td className="px-4 py-3"><span className="bg-indigo-100 text-indigo-700 px-2 py-1 rounded text-xs font-bold uppercase">{u.role}</span></td>
                                  <td className="px-4 py-3">{u.godown_name || '—'}</td>
                                  <td className="px-4 py-3"><span className={`font-medium text-xs ${u.is_active ? 'text-emerald-600' : 'text-slate-500'}`}>{u.is_active ? 'Active' : 'Inactive'}</span></td>
                                  <td className="px-4 py-3 text-right space-x-2">
                                    <Button variant="ghost" size="sm" onClick={() => openEditUser(u)}>Manage</Button>
                                    <Button variant="ghost" size="sm" onClick={() => updateUser.mutate({ id: u.id, data: { is_active: !u.is_active } })}>{u.is_active ? 'Disable' : 'Enable'}</Button>
                                  </td>
                                </tr>
                              ))}
                           </tbody>
                        </table>
                     </div>
                     {editingUserId && editingUserId !== 'new' && (
                       <div className="mt-4 rounded-lg border p-4 grid md:grid-cols-5 gap-3">
                         <Input placeholder="Name" value={editUserForm.name} onChange={(e) => setEditUserForm((s) => ({ ...s, name: e.target.value }))} />
                         <Input placeholder="Email" value={editUserForm.email} onChange={(e) => setEditUserForm((s) => ({ ...s, email: e.target.value }))} />
                         <Input placeholder="Phone" value={editUserForm.phone} onChange={(e) => setEditUserForm((s) => ({ ...s, phone: e.target.value }))} />
                         <select className="h-10 rounded-md border bg-white px-3 text-sm" value={editUserForm.role} onChange={(e) => setEditUserForm((s) => ({ ...s, role: e.target.value }))}>
                           <option value="staff">staff</option><option value="cashier">cashier</option><option value="manager">manager</option><option value="accountant">accountant</option><option value="company_admin">company_admin</option>
                         </select>
                         <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={editUserForm.is_active} onChange={(e) => setEditUserForm((s) => ({ ...s, is_active: e.target.checked }))} />Active</label>
                         <div className="md:col-span-5 flex gap-2">
                           <Button onClick={() => updateUser.mutate({ id: editingUserId, data: editUserForm })} disabled={updateUser.isPending || !editUserForm.name}>Save changes</Button>
                           <Button variant="outline" onClick={() => setEditingUserId(null)}>Cancel</Button>
                         </div>
                       </div>
                     )}
                  </CardContent>
               )}

               {tab === 'godowns' && (
                  <CardContent className="p-6">
                     <div className="flex justify-between items-center mb-6">
                        <h2 className="text-xl font-bold">Godowns & Warehouses</h2>
                        <Button variant="outline" className="gap-2" onClick={() => setEditingGodownId('new')}><MapPin className="w-4 h-4"/> Add Godown</Button>
                     </div>
                     {editingGodownId === 'new' && (
                        <div className="mb-4 rounded-lg border p-4 grid md:grid-cols-4 gap-3">
                           <Input placeholder="Name" value={newGodown.name} onChange={(e) => setNewGodown((s) => ({ ...s, name: e.target.value }))} />
                           <Input placeholder="Code" value={newGodown.code} onChange={(e) => setNewGodown((s) => ({ ...s, code: e.target.value }))} />
                           <Input placeholder="City" value={newGodown.city} onChange={(e) => setNewGodown((s) => ({ ...s, city: e.target.value }))} />
                           <Input placeholder="State" value={newGodown.state} onChange={(e) => setNewGodown((s) => ({ ...s, state: e.target.value }))} />
                           <label className="md:col-span-4 text-sm flex items-center gap-2"><input type="checkbox" checked={newGodown.is_default} onChange={(e) => setNewGodown((s) => ({ ...s, is_default: e.target.checked }))} />Set as default</label>
                           <div className="md:col-span-4 flex gap-2">
                              <Button onClick={() => createGodown.mutate()} disabled={!newGodown.name || createGodown.isPending}>Create Godown</Button>
                              <Button variant="outline" onClick={() => setEditingGodownId(null)}>Cancel</Button>
                           </div>
                        </div>
                     )}
                     <div className="grid gap-4">
                        {godownsLoading && <div className="text-sm text-muted-foreground">Loading godowns…</div>}
                        {godownRows.map((g: any) => (
                          <div key={g.id} className="p-4 border rounded-lg flex items-center justify-between hover:border-indigo-300 transition-colors bg-slate-50/50">
                            <div className="flex gap-4 items-center">
                              <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-lg flex items-center justify-center font-bold">{(g.code || g.name || 'G').slice(0, 2).toUpperCase()}</div>
                              <div>
                                <p className="font-semibold text-slate-900">{g.name} {g.is_default ? <span className="text-xs text-indigo-600">(Default)</span> : null}</p>
                                <p className="text-xs text-slate-500">{[g.city, g.state].filter(Boolean).join(', ') || '—'} • {g.manager_name || 'No manager'}</p>
                              </div>
                            </div>
                            <div className="space-x-2">
                              <Button variant="ghost" size="sm" onClick={() => openEditGodown(g)}>Edit</Button>
                              <Button variant="ghost" size="sm" onClick={() => updateGodown.mutate({ id: g.id, data: { is_active: !g.is_active } })}>
                                {g.is_active ? 'Disable' : 'Enable'}
                              </Button>
                            </div>
                          </div>
                        ))}
                     </div>
                     {editingGodownId && editingGodownId !== 'new' && (
                       <div className="mt-4 rounded-lg border p-4 grid md:grid-cols-4 gap-3">
                         <Input placeholder="Name" value={editGodownForm.name} onChange={(e) => setEditGodownForm((s) => ({ ...s, name: e.target.value }))} />
                         <Input placeholder="Code" value={editGodownForm.code} onChange={(e) => setEditGodownForm((s) => ({ ...s, code: e.target.value }))} />
                         <Input placeholder="City" value={editGodownForm.city} onChange={(e) => setEditGodownForm((s) => ({ ...s, city: e.target.value }))} />
                         <Input placeholder="State" value={editGodownForm.state} onChange={(e) => setEditGodownForm((s) => ({ ...s, state: e.target.value }))} />
                         <label className="md:col-span-4 text-sm flex items-center gap-2"><input type="checkbox" checked={editGodownForm.is_default} onChange={(e) => setEditGodownForm((s) => ({ ...s, is_default: e.target.checked }))} />Set as default</label>
                         <label className="md:col-span-4 text-sm flex items-center gap-2"><input type="checkbox" checked={editGodownForm.is_active} onChange={(e) => setEditGodownForm((s) => ({ ...s, is_active: e.target.checked }))} />Active</label>
                         <div className="md:col-span-4 flex gap-2">
                           <Button onClick={() => updateGodown.mutate({ id: editingGodownId, data: editGodownForm })} disabled={!editGodownForm.name || updateGodown.isPending}>Save changes</Button>
                           <Button variant="outline" onClick={() => setEditingGodownId(null)}>Cancel</Button>
                         </div>
                       </div>
                     )}
                  </CardContent>
               )}

               {tab === 'invoices' && (
                  <CardContent className="p-6 space-y-6">
                     <h2 className="text-xl font-bold">Invoice Configuration</h2>
                     <div className="space-y-4">
                        <div>
                           <label className="text-sm font-medium text-slate-700">Invoice Prefix Sequence</label>
                          <Input value={invoicePrefix} onChange={(e) => setInvoicePrefix(e.target.value)} className="mt-1 max-w-xs font-mono" />
                           <p className="text-xs text-slate-500 mt-1">Example output: INV/MUM/25-26/0001</p>
                        </div>
                        <div>
                           <label className="text-sm font-medium text-slate-700">Default Terms & Conditions</label>
                          <textarea className="w-full mt-1 border rounded-md p-3 h-32 text-sm" value={invoiceTerms} onChange={(e) => setInvoiceTerms(e.target.value)} />
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
                       <Button onClick={saveInvoicePreferences} disabled={updateCompany.isPending}>Save Preferences</Button>
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
                          <select className="w-full mt-1 h-10 border rounded px-3 bg-white" value={itemTerminologySingular} onChange={(e) => setItemTerminologySingular(e.target.value)}>
                             <option>Item</option>
                             <option>Product</option>
                             <option>Part</option>
                             <option>Medicine</option>
                           </select>
                        </div>
                        <div>
                           <label className="text-sm font-medium text-slate-700">Primary Default GST %</label>
                          <select className="w-full mt-1 h-10 border rounded px-3 bg-white" value={defaultGstRate} onChange={(e) => setDefaultGstRate(e.target.value)}>
                              <option value="18">18% Standard</option>
                              <option value="12">12%</option>
                              <option value="5">5%</option>
                              <option value="0">0%</option>
                           </select>
                        </div>
                     </div>
                    <div className="space-y-3">
                      <div>
                        <label className="text-sm font-medium text-slate-700">Plural label</label>
                        <Input value={itemTerminologyPlural} onChange={(e) => setItemTerminologyPlural(e.target.value)} className="mt-1 max-w-xs" />
                      </div>
                      <Button className="mt-1" onClick={applyItemSchema} disabled={updateCompany.isPending}>Apply Schema</Button>
                    </div>
                  </CardContent>
               )}

               {tab === 'data' && (
                  <CardContent className="p-6 space-y-6">
                     <h2 className="text-xl font-bold">Data Management Flow</h2>
                     <input
                       ref={importFileRef}
                       type="file"
                       accept=".csv,.xlsx,.xls,.json"
                       className="hidden"
                       onChange={(e) => uploadImportFile(e.target.files?.[0])}
                     />
                     <div className="grid md:grid-cols-2 gap-6">
                        <Card className="border-indigo-100 shadow-sm">
                           <CardContent className="p-6 flex flex-col items-center text-center">
                              <div className="w-12 h-12 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-600 mb-3"><Upload className="w-6 h-6"/></div>
                              <h3 className="font-bold text-slate-900 mb-1">Import Legacy Data</h3>
                              <p className="text-sm text-slate-500 mb-4">Upload Item Masters or Customer ledgers via structured CSV.</p>
                              <div className="w-full space-y-2">
                                <Button variant="outline" className="w-full" onClick={downloadItemsTemplate}>Download item template</Button>
                                <Button variant="outline" className="w-full" onClick={() => importFileRef.current?.click()} disabled={importing}>
                                  {importing ? 'Importing…' : 'Upload CSV / XLSX / JSON'}
                                </Button>
                              </div>
                           </CardContent>
                        </Card>
                        <Card className="border-emerald-100 shadow-sm">
                           <CardContent className="p-6 flex flex-col items-center text-center">
                              <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-600 mb-3"><Database className="w-6 h-6"/></div>
                              <h3 className="font-bold text-slate-900 mb-1">Export JSON / Tally DB</h3>
                              <p className="text-sm text-slate-500 mb-4">Push localized records to universal schemas.</p>
                              <Button variant="outline" className="w-full border-emerald-600 text-emerald-700" onClick={dumpData}>Dump Data</Button>
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
