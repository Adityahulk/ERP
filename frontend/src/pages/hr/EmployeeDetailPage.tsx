import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getApiBaseURL } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { formatMoney } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft, Upload, FileText, ReceiptIndianRupee, Plus, User,
  Mail, Phone, MapPin, Calendar, Briefcase, Building2, CreditCard,
  ShieldCheck, AlertCircle
} from 'lucide-react';
import toast from 'react-hot-toast';
import { normalizeRole } from '@/lib/roles';

const uploadsBase = () => getApiBaseURL().replace(/\/api$/, '');
const fileUrl = (url?: string) => (url && String(url).startsWith('http') ? url : `${uploadsBase()}${url || ''}`);

const ROLE_COLORS: Record<string, string> = {
  super_admin: 'bg-purple-100 text-purple-700',
  admin: 'bg-indigo-100 text-indigo-700',
  manager: 'bg-blue-100 text-blue-700',
  staff: 'bg-slate-100 text-slate-600',
};

function InfoRow({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 py-2.5 border-b last:border-0">
      <Icon className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}

function EditableField({ label, value, onSave, type = 'text', placeholder, className = '' }: {
  label: string; value?: string; onSave: (v: string) => void;
  type?: string; placeholder?: string; className?: string;
}) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type={type}
        className={`mt-1 h-9 ${className}`}
        defaultValue={value || ''}
        placeholder={placeholder}
        onBlur={(e) => { if (e.target.value !== (value || '')) onSave(e.target.value); }}
      />
    </div>
  );
}

export default function EmployeeDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const { user: me } = useAuthStore();
  const qc = useQueryClient();

  const actualRole = normalizeRole(me?.role);
  const isAdmin = ['admin', 'super_admin'].includes(actualRole);
  const canManage = ['manager', 'admin', 'super_admin'].includes(actualRole);
  const canPayroll = ['admin', 'super_admin'].includes(actualRole);
  const isSelf = !userId || userId === me?.id || userId === 'me';
  const canEdit = isAdmin || isSelf;

  // Redirect non-admins trying to view other profiles
  if (!isSelf && !canManage) {
    navigate('/profile', { replace: true });
  }

  const effectiveUserId = isSelf ? 'me' : userId!;
  const apiPath = effectiveUserId === 'me' ? '/employees/me' : `/employees/${effectiveUserId}`;

  const { data: profile, isLoading } = useQuery({
    queryKey: ['employee-profile', effectiveUserId],
    queryFn: () => api.get(apiPath).then((r) => r.data?.data ?? r.data),
  });

  const [docType, setDocType] = useState('ID Proof');
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [adjustment, setAdjustment] = useState({ adjustment_type: 'bonus', title: '', amount: '', notes: '' });

  const saveProfileMut = useMutation({
    mutationFn: (data: any) => {
      const patchPath = effectiveUserId === 'me' ? '/employees/me' : `/employees/${profile?.id || effectiveUserId}`;
      return api.patch(patchPath, data);
    },
    onSuccess: () => {
      toast.success('Saved');
      qc.invalidateQueries({ queryKey: ['employee-profile', effectiveUserId] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Save failed'),
  });

  const uploadDocMut = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('document', file);
      fd.append('document_type', docType);
      const path = effectiveUserId === 'me' ? '/employees/me/documents' : `/employees/${profile?.id || effectiveUserId}/documents`;
      return api.post(path, fd);
    },
    onSuccess: () => {
      toast.success('Document uploaded');
      qc.invalidateQueries({ queryKey: ['employee-profile', effectiveUserId] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Upload failed'),
  });

  const addAdjustmentMut = useMutation({
    mutationFn: () => api.post(`/employees/${profile?.id || effectiveUserId}/salary-adjustments`, {
      ...adjustment,
      salary_month: `${month}-01`,
      amount: Math.round((Number(adjustment.amount) || 0) * 100),
    }),
    onSuccess: () => {
      toast.success('Adjustment added');
      setAdjustment({ adjustment_type: 'bonus', title: '', amount: '', notes: '' });
      qc.invalidateQueries({ queryKey: ['employee-profile', effectiveUserId] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const salarySlipMut = useMutation({
    mutationFn: () =>
      api.post(`/employees/${profile?.id || effectiveUserId}/salary-slips`, { salary_month: `${month}-01` })
        .then((r) => r.data?.data ?? r.data),
    onSuccess: (slip: any) => toast.success(`Slip generated: net ${formatMoney(slip.net_salary || 0)}`),
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const save = (field: string) => (v: string) => saveProfileMut.mutate({ [field]: v });

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-1/3" />
          <div className="h-48 bg-muted rounded" />
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="max-w-5xl mx-auto p-6 text-center">
        <AlertCircle className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
        <p className="text-lg font-medium">Employee not found</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate(-1)}>Go back</Button>
      </div>
    );
  }

  const initials = (profile.name || '?').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
      {/* Back + Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="text-xl font-bold">{isSelf ? 'My Profile' : 'Employee Profile'}</h1>
      </div>

      {/* Identity Banner */}
      <Card>
        <CardContent className="p-5 flex items-center gap-5">
          <div className="w-16 h-16 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xl font-bold shrink-0 overflow-hidden">
            {profile.avatar_url ? <img src={fileUrl(profile.avatar_url)} alt="" className="w-full h-full object-cover" /> : initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-xl font-bold">{profile.name}</h2>
              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${ROLE_COLORS[normalizeRole(profile.role)] || 'bg-slate-100 text-slate-600'}`}>
                {profile.role?.replace('_', ' ')}
              </span>
              {profile.is_active === false && (
                <Badge variant="outline" className="text-red-500 border-red-200 text-xs">Inactive</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1">{profile.email}</p>
            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
              {profile.employee_code && <span className="font-mono bg-muted px-2 py-0.5 rounded">{profile.employee_code}</span>}
              {profile.designation && <span>{profile.designation}</span>}
              {profile.department && <span>· {profile.department}</span>}
              {profile.godown_name && <span>· {profile.godown_name}</span>}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Work Details - Read view */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Briefcase className="w-4 h-4" /> Work Details</CardTitle></CardHeader>
          <CardContent className="px-5 pb-5">
            <InfoRow icon={Mail} label="Email" value={profile.email} />
            <InfoRow icon={Phone} label="Phone" value={profile.phone} />
            <InfoRow icon={Building2} label="Department" value={profile.department} />
            <InfoRow icon={Briefcase} label="Designation" value={profile.designation} />
            <InfoRow icon={MapPin} label="Location" value={profile.godown_name} />
            <InfoRow icon={Calendar} label="Joining Date" value={profile.joining_date ? new Date(profile.joining_date).toLocaleDateString('en-IN') : ''} />
            <InfoRow icon={User} label="Employment Type" value={profile.employment_type} />
          </CardContent>
        </Card>

        {/* Personal Details - Editable */}
        {canEdit && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><User className="w-4 h-4" /> Personal Details</CardTitle></CardHeader>
            <CardContent className="px-5 pb-5 space-y-3">
              <EditableField label="Designation" value={profile.designation} onSave={save('designation')} placeholder="e.g. Sales Executive" />
              <EditableField label="Department" value={profile.department} onSave={save('department')} placeholder="e.g. Sales" />
              <EditableField label="Address" value={profile.address} onSave={save('address')} placeholder="Full address" />
              <EditableField label="Date of Birth" value={profile.date_of_birth?.slice(0, 10)} onSave={save('date_of_birth')} type="date" />
              <EditableField label="PAN Number" value={profile.pan_number} onSave={save('pan_number')} placeholder="ABCDE1234F" className="uppercase font-mono" />
              <EditableField label="Aadhar Last 4" value={profile.aadhar_last4} onSave={save('aadhar_last4')} placeholder="XXXX" className="font-mono" />
              <div className="grid grid-cols-2 gap-3">
                <EditableField label="Emergency Contact" value={profile.emergency_contact_name} onSave={save('emergency_contact_name')} placeholder="Name" />
                <EditableField label="Emergency Phone" value={profile.emergency_contact_phone} onSave={save('emergency_contact_phone')} placeholder="Phone" />
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Bank & Salary (self or admin only) */}
      {canEdit && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><CreditCard className="w-4 h-4" /> Bank & Salary</CardTitle></CardHeader>
          <CardContent className="px-5 pb-5">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Bank Details</p>
                <EditableField label="Bank Name" value={profile.bank_name} onSave={save('bank_name')} placeholder="e.g. HDFC Bank" />
                <EditableField label="Account Number" value={profile.bank_account_number} onSave={save('bank_account_number')} placeholder="Account number" className="font-mono" />
                <EditableField label="IFSC Code" value={profile.bank_ifsc} onSave={save('bank_ifsc')} placeholder="HDFC0001234" className="uppercase font-mono" />
              </div>
              {(isAdmin || canPayroll) && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Salary Structure (₹/month)</p>
                  <EditableField label="Monthly Salary (₹)" value={profile.monthly_salary ? String(profile.monthly_salary / 100) : ''} onSave={(v) => save('monthly_salary')(String(Math.round((Number(v) || 0) * 100)))} type="number" placeholder="Total monthly CTC" />
                  <EditableField label="Basic Salary (₹)" value={profile.basic_salary ? String(profile.basic_salary / 100) : ''} onSave={(v) => save('basic_salary')(String(Math.round((Number(v) || 0) * 100)))} type="number" placeholder="Basic" />
                  <EditableField label="HRA (₹)" value={profile.hra ? String(profile.hra / 100) : ''} onSave={(v) => save('hra')(String(Math.round((Number(v) || 0) * 100)))} type="number" placeholder="HRA" />
                  <EditableField label="Allowances (₹)" value={profile.allowances ? String(profile.allowances / 100) : ''} onSave={(v) => save('allowances')(String(Math.round((Number(v) || 0) * 100)))} type="number" placeholder="Other allowances" />
                  <EditableField label="Fixed Deductions (₹)" value={profile.deductions ? String(profile.deductions / 100) : ''} onSave={(v) => save('deductions')(String(Math.round((Number(v) || 0) * 100)))} type="number" placeholder="PF, ESI, etc." />
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Documents */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><FileText className="w-4 h-4" /> Documents</CardTitle></CardHeader>
        <CardContent className="px-5 pb-5 space-y-4">
          {canEdit && (
            <div className="flex flex-wrap gap-2 items-center">
              <Input className="max-w-xs h-9" value={docType} onChange={(e) => setDocType(e.target.value)} placeholder="Document type (e.g. Aadhar, PAN)" />
              <label className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm cursor-pointer hover:bg-muted transition-colors">
                <Upload className="h-4 w-4" /> Upload
                <input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && uploadDocMut.mutate(e.target.files[0])} />
              </label>
            </div>
          )}
          {(profile?.documents || []).length === 0 && (
            <p className="text-sm text-muted-foreground">No documents uploaded.</p>
          )}
          <div className="grid md:grid-cols-2 gap-3">
            {(profile?.documents || []).map((d: any) => (
              <a key={d.id} href={fileUrl(d.file_url)} target="_blank" rel="noreferrer"
                className="rounded-lg border p-3 text-sm hover:bg-muted/50 flex gap-3 transition-colors">
                <FileText className="h-5 w-5 text-indigo-500 mt-0.5 shrink-0" />
                <span>
                  <span className="font-medium block">{d.document_type}</span>
                  <span className="text-muted-foreground text-xs">{d.document_name}</span>
                </span>
              </a>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Salary Slip & Adjustments (admin/payroll only) */}
      {canPayroll && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><ReceiptIndianRupee className="w-4 h-4" /> Payroll</CardTitle></CardHeader>
          <CardContent className="px-5 pb-5 space-y-5">
            {/* Generate Slip */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Salary Slip</p>
              <div className="flex flex-wrap gap-2 items-center">
                <Input type="month" className="max-w-[180px] h-9" value={month} onChange={(e) => setMonth(e.target.value)} />
                <Button onClick={() => salarySlipMut.mutate()} loading={salarySlipMut.isPending} size="sm" className="gap-2">
                  <ReceiptIndianRupee className="h-4 w-4" /> Generate Slip
                </Button>
              </div>
            </div>

            {/* Adjustments */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Add Adjustment</p>
              <div className="flex flex-wrap gap-2">
                <select
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                  value={adjustment.adjustment_type}
                  onChange={(e) => setAdjustment((s) => ({ ...s, adjustment_type: e.target.value }))}>
                  <option value="bonus">Bonus</option>
                  <option value="deduction">Deduction</option>
                </select>
                <Input className="h-9 w-36" placeholder="Title" value={adjustment.title} onChange={(e) => setAdjustment((s) => ({ ...s, title: e.target.value }))} />
                <Input type="number" className="h-9 w-28" placeholder="Amount ₹" value={adjustment.amount} onChange={(e) => setAdjustment((s) => ({ ...s, amount: e.target.value }))} />
                <Input className="h-9 w-40" placeholder="Notes (optional)" value={adjustment.notes} onChange={(e) => setAdjustment((s) => ({ ...s, notes: e.target.value }))} />
                <Button size="sm" className="h-9 gap-1" onClick={() => addAdjustmentMut.mutate()} disabled={!adjustment.title || !adjustment.amount} loading={addAdjustmentMut.isPending}>
                  <Plus className="h-4 w-4" /> Add
                </Button>
              </div>
            </div>

            {/* Recent Adjustments */}
            {(profile?.salary_adjustments || []).length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Recent Adjustments</p>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                        <th className="px-3 py-2 text-left">Month</th>
                        <th className="px-3 py-2 text-left">Type</th>
                        <th className="px-3 py-2 text-left">Title</th>
                        <th className="px-3 py-2 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(profile.salary_adjustments || []).slice(0, 10).map((a: any) => (
                        <tr key={a.id} className="border-b last:border-0">
                          <td className="px-3 py-2 text-xs text-muted-foreground">{a.salary_month?.slice(0, 7)}</td>
                          <td className="px-3 py-2">
                            <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${a.adjustment_type === 'bonus' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                              {a.adjustment_type}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-sm">{a.title}</td>
                          <td className={`px-3 py-2 text-right tabular-nums font-medium ${a.adjustment_type === 'bonus' ? 'text-emerald-600' : 'text-red-600'}`}>
                            {a.adjustment_type === 'bonus' ? '+' : '-'}{formatMoney(parseInt(a.amount) || 0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Security & Access (admin only) */}
      {isAdmin && !isSelf && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Access & Status</CardTitle></CardHeader>
          <CardContent className="px-5 pb-5">
            <div className="flex items-center gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Current Role</p>
                <p className="font-medium capitalize">{profile.role?.replace('_', ' ')}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Account Status</p>
                <p className={`font-medium ${profile.is_active !== false ? 'text-emerald-600' : 'text-red-500'}`}>
                  {profile.is_active !== false ? 'Active' : 'Inactive'}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Joining Date</p>
                <p className="font-medium">{profile.joining_date ? new Date(profile.joining_date).toLocaleDateString('en-IN') : '—'}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
