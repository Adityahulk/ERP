import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, FileText, ReceiptIndianRupee, Plus, ShieldCheck, Users, Calendar, Key, CheckCircle2, AlertCircle } from 'lucide-react';
import api, { getApiBaseURL } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatMoney } from '@/lib/formatters';
import toast from 'react-hot-toast';

const uploadsBase = () => getApiBaseURL().replace(/\/api$/, '');
const fileUrl = (url?: string) => (url && String(url).startsWith('http') ? url : `${uploadsBase()}${url || ''}`);

function formatDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const TIER_COLORS: Record<string, string> = {
  silver: 'text-slate-400',
  gold: 'text-yellow-500',
  diamond: 'text-cyan-400',
};

export default function ProfilePage() {
  const { user, license } = useAuthStore();
  const qc = useQueryClient();
  const [docType, setDocType] = useState('ID Proof');
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [adjustment, setAdjustment] = useState({ adjustment_type: 'bonus', title: '', amount: '', notes: '' });
  const canPayroll = ['accountant', 'company_admin', 'super_admin'].includes(user?.role || '');

  const { data: profile, isLoading } = useQuery({
    queryKey: ['employee-profile', 'me'],
    queryFn: () => api.get('/employees/me').then((r) => r.data?.data ?? r.data),
  });

  const saveProfile = useMutation({
    mutationFn: (data: any) => api.patch('/employees/me', data),
    onSuccess: () => {
      toast.success('Profile saved');
      qc.invalidateQueries({ queryKey: ['employee-profile', 'me'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Save failed'),
  });

  const uploadDoc = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('document', file);
      fd.append('document_type', docType);
      return api.post('/employees/me/documents', fd);
    },
    onSuccess: () => {
      toast.success('Document uploaded');
      qc.invalidateQueries({ queryKey: ['employee-profile', 'me'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Upload failed'),
  });

  const addAdjustment = useMutation({
    mutationFn: () => api.post(`/employees/${user?.id}/salary-adjustments`, {
      ...adjustment,
      salary_month: `${month}-01`,
      amount: Math.round((Number(adjustment.amount) || 0) * 100),
    }),
    onSuccess: () => {
      toast.success('Salary adjustment added');
      setAdjustment({ adjustment_type: 'bonus', title: '', amount: '', notes: '' });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Adjustment failed'),
  });

  const salarySlip = useMutation({
    mutationFn: () => api.post(`/employees/${user?.id}/salary-slips`, { salary_month: `${month}-01` }).then((r) => r.data?.data ?? r.data),
    onSuccess: (slip: any) => toast.success(`Salary slip generated: net ${formatMoney(slip.net_salary || 0)}`),
    onError: (e: any) => toast.error(e.response?.data?.error || 'Salary slip failed'),
  });

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Loading profile…</div>;

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">My Profile</h1>
        <p className="text-sm text-slate-500">Personal, documents, bank, salary and payroll details.</p>
      </div>

      {/* ── License Info Card ── */}
      {license && (
        <Card className="border-violet-200 bg-gradient-to-r from-violet-50 to-indigo-50">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-violet-600" />
              License Information
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-slate-500 mb-1">Plan</p>
                <p className={`font-bold text-lg ${TIER_COLORS[license.tier_name] || 'text-violet-700'}`}>
                  {license.tier_display_name}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1 flex items-center gap-1">
                  <Users className="w-3 h-3" /> User Seats
                </p>
                <p className="font-semibold text-slate-800">
                  {license.used_users} / {license.max_users} used
                </p>
                <div className="mt-1.5 h-1.5 bg-slate-200 rounded-full overflow-hidden w-24">
                  <div
                    className="h-full bg-violet-500 rounded-full"
                    style={{ width: `${Math.min((license.used_users / license.max_users) * 100, 100)}%` }}
                  />
                </div>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1 flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> Expires
                </p>
                <p className="font-medium text-slate-700">{formatDate(license.expires_at)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Status</p>
                <div className={`inline-flex items-center gap-1.5 text-sm font-semibold ${license.status === 'active' ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {license.status === 'active'
                    ? <CheckCircle2 className="w-4 h-4" />
                    : <AlertCircle className="w-4 h-4" />
                  }
                  {license.status.charAt(0).toUpperCase() + license.status.slice(1)}
                </div>
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-violet-100 flex items-center gap-2">
              <Key className="w-3 h-3 text-slate-400" />
              <span className="text-xs text-slate-400">License Key:</span>
              <span className="text-xs font-mono text-slate-500">
                {license.license_key.slice(0, 8)}…{license.license_key.slice(-4)}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Employee Details</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-slate-500">Name</span><p className="font-medium">{profile?.name}</p></div>
              <div><span className="text-slate-500">Role</span><p className="font-medium capitalize">{profile?.role}</p></div>
              <div><span className="text-slate-500">Code</span><p className="font-medium">{profile?.employee_code || '—'}</p></div>
              <div><span className="text-slate-500">Location</span><p className="font-medium">{profile?.godown_name || '—'}</p></div>
            </div>
            <Input placeholder="Designation" defaultValue={profile?.designation || ''} onBlur={(e) => saveProfile.mutate({ designation: e.target.value })} />
            <Input placeholder="Department" defaultValue={profile?.department || ''} onBlur={(e) => saveProfile.mutate({ department: e.target.value })} />
            <Input placeholder="Address" defaultValue={profile?.address || ''} onBlur={(e) => saveProfile.mutate({ address: e.target.value })} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Bank & Salary</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder="Bank name" defaultValue={profile?.bank_name || ''} onBlur={(e) => saveProfile.mutate({ bank_name: e.target.value })} />
            <Input placeholder="Account number" defaultValue={profile?.bank_account_number || ''} onBlur={(e) => saveProfile.mutate({ bank_account_number: e.target.value })} />
            <Input placeholder="IFSC" className="uppercase" defaultValue={profile?.bank_ifsc || ''} onBlur={(e) => saveProfile.mutate({ bank_ifsc: e.target.value.toUpperCase() })} />
            <Input type="number" placeholder="Monthly salary (₹)" defaultValue={profile?.monthly_salary ? String(profile.monthly_salary / 100) : ''} onBlur={(e) => saveProfile.mutate({ monthly_salary: Math.round((Number(e.target.value) || 0) * 100) })} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Documents</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Input className="max-w-xs" value={docType} onChange={(e) => setDocType(e.target.value)} placeholder="Document type" />
            <label className="inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm cursor-pointer hover:bg-slate-50">
              <Upload className="h-4 w-4" />
              Upload
              <input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && uploadDoc.mutate(e.target.files[0])} />
            </label>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            {(profile?.documents || []).map((d: any) => (
              <a key={d.id} href={fileUrl(d.file_url)} target="_blank" rel="noreferrer" className="rounded-lg border p-3 text-sm hover:bg-slate-50 flex gap-2">
                <FileText className="h-4 w-4 text-indigo-600 mt-0.5" />
                <span><span className="font-medium">{d.document_type}</span><br /><span className="text-slate-500">{d.document_name}</span></span>
              </a>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Salary Slip</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Input type="month" className="max-w-xs" value={month} onChange={(e) => setMonth(e.target.value)} />
            <Button onClick={() => salarySlip.mutate()} loading={salarySlip.isPending} className="gap-2">
              <ReceiptIndianRupee className="h-4 w-4" /> Generate salary slip
            </Button>
          </div>
          {canPayroll && (
            <div className="grid md:grid-cols-5 gap-2 rounded-lg border p-3">
              <select className="h-10 rounded-md border bg-white px-3 text-sm" value={adjustment.adjustment_type} onChange={(e) => setAdjustment((s) => ({ ...s, adjustment_type: e.target.value }))}>
                <option value="bonus">Bonus</option>
                <option value="deduction">Deduction</option>
              </select>
              <Input placeholder="Title" value={adjustment.title} onChange={(e) => setAdjustment((s) => ({ ...s, title: e.target.value }))} />
              <Input type="number" placeholder="Amount ₹" value={adjustment.amount} onChange={(e) => setAdjustment((s) => ({ ...s, amount: e.target.value }))} />
              <Input placeholder="Notes" value={adjustment.notes} onChange={(e) => setAdjustment((s) => ({ ...s, notes: e.target.value }))} />
              <Button onClick={() => addAdjustment.mutate()} disabled={!adjustment.title || !adjustment.amount} loading={addAdjustment.isPending} className="gap-1">
                <Plus className="h-4 w-4" /> Add
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
