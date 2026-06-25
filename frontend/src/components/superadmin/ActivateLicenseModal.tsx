import { useState, useEffect } from 'react';
import { X, RefreshCw } from 'lucide-react';
import { activateSuperAdminLicense } from '@/lib/superAdminApi';

function generatePassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const special = '!@#$';
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  const all = upper + lower + digits + special;
  let rest = '';
  for (let i = 0; i < 8; i++) rest += all[Math.floor(Math.random() * all.length)];
  return pick(upper) + pick(lower) + pick(digits) + pick(special) + rest;
}

interface Props {
  licenseId: string;
  tierDisplayName: string;
  maxUsers: number;
  open: boolean;
  onClose: () => void;
  onActivated: () => void;
  onSuccessCredentials: (payload: {
    companyName: string;
    adminEmail: string;
    adminPassword: string;
    tierLabel: string;
    maxUsers: number;
    expiresDays: number;
  }) => void;
}

export default function ActivateLicenseModal({
  licenseId,
  tierDisplayName,
  maxUsers,
  open,
  onClose,
  onActivated,
  onSuccessCredentials,
}: Props) {
  const [companyName, setCompanyName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState(() => generatePassword());
  const [expiresDays, setExpiresDays] = useState(365);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setErr(null);
      setCompanyName('');
      setAdminName('');
      setAdminEmail('');
      setAdminPassword(generatePassword());
      setExpiresDays(365);
      setNotes('');
    }
  }, [open, licenseId]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">Activate license</h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg text-slate-500 hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form
          className="p-5 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setErr(null);
            setLoading(true);
            try {
              const res = await activateSuperAdminLicense(licenseId, {
                company_name: companyName,
                admin_name: adminName,
                admin_email: adminEmail,
                admin_password: adminPassword,
                expires_days: expiresDays,
                notes: notes || undefined,
              });
              onActivated();
              onSuccessCredentials({
                companyName: res.company?.name ?? companyName,
                adminEmail: res.admin_user?.email ?? adminEmail,
                adminPassword: res.admin_password ?? adminPassword,
                tierLabel: res.tier ?? tierDisplayName,
                maxUsers: res.max_users ?? maxUsers,
                expiresDays,
              });
              onClose();
            } catch (ex: unknown) {
              const msg =
                (ex as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Activation failed';
              setErr(msg);
            } finally {
              setLoading(false);
            }
          }}
        >
          {err && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</div>}
          <div>
            <label className="text-xs font-medium text-slate-600">Company name</label>
            <input
              required
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600">Admin name</label>
            <input
              required
              value={adminName}
              onChange={(e) => setAdminName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600">Admin email</label>
            <input
              required
              type="email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-600">Admin password</label>
              <button
                type="button"
                onClick={() => setAdminPassword(generatePassword())}
                className="text-xs text-violet-600 inline-flex items-center gap-1 font-medium"
              >
                <RefreshCw className="w-3 h-3" />
                Generate
              </button>
            </div>
            <input
              required
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600">Expiry (days)</label>
            <input
              required
              type="number"
              min={1}
              value={expiresDays}
              onChange={(e) => setExpiresDays(parseInt(e.target.value, 10) || 365)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-700 rounded-lg hover:bg-slate-100">
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-sm font-semibold text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-50"
            >
              {loading ? 'Activating…' : 'Activate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
