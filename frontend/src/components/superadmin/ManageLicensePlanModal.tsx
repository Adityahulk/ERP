import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { fetchSuperAdminLicenseTiers, updateSuperAdminLicensePlan, type LicenseTierRow } from '@/lib/superAdminApi';

interface Props {
  open: boolean;
  licenseId: string;
  currentTierId?: string;
  currentStatus?: string;
  onClose: () => void;
  onUpdated: () => void;
}

export default function ManageLicensePlanModal({ open, licenseId, currentTierId, currentStatus, onClose, onUpdated }: Props) {
  const { data: tiers = [], isLoading } = useQuery({
    queryKey: ['superadmin', 'license-tiers'],
    queryFn: fetchSuperAdminLicenseTiers,
    enabled: open,
  });
  const [tierId, setTierId] = useState('');
  const [status, setStatus] = useState<'active' | 'trial'>('active');
  const [expiresDays, setExpiresDays] = useState('365');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTierId(currentTierId || '');
    setStatus(currentStatus === 'trial' ? 'trial' : 'active');
    setExpiresDays(currentStatus === 'trial' ? '15' : '365');
    setNotes('');
  }, [open, currentTierId, currentStatus]);

  useEffect(() => {
    if (!open || tierId || !tiers.length) return;
    setTierId(tiers.find((tier) => tier.name === 'diamond')?.id || tiers[0].id);
  }, [open, tierId, tiers]);

  if (!open) return null;

  const selectedTier: LicenseTierRow | undefined = tiers.find((tier) => tier.id === tierId);

  const submit = async () => {
    if (!tierId) {
      toast.error('Select a plan');
      return;
    }
    const days = parseInt(expiresDays, 10);
    if (!days || days < 1) {
      toast.error('Enter valid expiry days');
      return;
    }
    setSaving(true);
    try {
      await updateSuperAdminLicensePlan(licenseId, {
        tier_id: tierId,
        status,
        expires_days: days,
        notes: notes.trim() || undefined,
      });
      toast.success(status === 'trial' ? 'Trial updated' : 'Plan assigned');
      onUpdated();
      onClose();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to update plan');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
        <div className="border-b px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Manage License Plan</h2>
          <p className="mt-1 text-xs text-slate-500">
            Use this to extend a trial or directly give a paid plan to a registrant/company.
          </p>
        </div>
        <div className="space-y-4 p-5">
          <div>
            <label className="text-sm font-medium text-slate-700">Plan</label>
            <select
              className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
              value={tierId}
              disabled={isLoading}
              onChange={(e) => setTierId(e.target.value)}
            >
              <option value="">Select plan</option>
              {tiers.map((tier) => (
                <option key={tier.id} value={tier.id}>
                  {tier.display_name} · {tier.max_users} users · ₹{Number(tier.price_inr).toLocaleString('en-IN')}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium text-slate-700">Status to set</label>
              <select
                className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                value={status}
                onChange={(e) => setStatus(e.target.value as 'active' | 'trial')}
              >
                <option value="active">Active paid plan</option>
                <option value="trial">Free trial</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">Valid for days</label>
              <input
                className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
                inputMode="numeric"
                value={expiresDays}
                onChange={(e) => setExpiresDays(e.target.value.replace(/\D/g, ''))}
              />
            </div>
          </div>
          {selectedTier && (
            <div className="rounded-lg border border-violet-100 bg-violet-50 px-3 py-2 text-xs text-violet-900">
              Selected: {selectedTier.display_name}, {selectedTier.max_users} seats. Existing company access will use this plan immediately.
            </div>
          )}
          <div>
            <label className="text-sm font-medium text-slate-700">Admin note</label>
            <textarea
              className="mt-1 min-h-[78px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Payment reference, trial extension reason, sales note..."
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t px-5 py-4">
          <button type="button" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || isLoading}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            onClick={submit}
          >
            {saving ? 'Saving…' : 'Save plan'}
          </button>
        </div>
      </div>
    </div>
  );
}
