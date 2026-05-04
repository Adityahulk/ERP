import { Clock, ArrowUpRight, X } from 'lucide-react';
import { useState } from 'react';
import { useAuthStore } from '@/store/authStore';

export default function TrialBanner() {
  const { license } = useAuthStore();
  const [dismissed, setDismissed] = useState(false);

  if (!license || license.status !== 'trial' || dismissed) return null;

  const days = license.trial_days_remaining ?? 0;
  const expired = days <= 0;

  const isUrgent = days <= 3;
  const isWarning = days <= 7 && days > 3;

  const bannerColor = expired
    ? 'bg-red-600 border-red-500'
    : isUrgent
    ? 'bg-red-500/90 border-red-400'
    : isWarning
    ? 'bg-amber-500/90 border-amber-400'
    : 'bg-violet-600/90 border-violet-400';

  const message = expired
    ? 'Your free trial has ended. Upgrade to continue using Microtechnique Accounts.'
    : `Your free trial ends in ${days} day${days === 1 ? '' : 's'}.`;

  return (
    <div className={`${bannerColor} border-b px-4 py-2 flex items-center justify-between gap-4 text-white text-sm`}>
      <div className="flex items-center gap-2">
        <Clock className="w-4 h-4 shrink-0" />
        <span>{message}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <a
          href="tel:+919876543210"
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white/20 hover:bg-white/30 font-semibold text-xs transition-colors"
        >
          Upgrade Now
          <ArrowUpRight className="w-3 h-3" />
        </a>
        {!expired && (
          <button
            onClick={() => setDismissed(true)}
            className="p-1 rounded hover:bg-white/20 transition-colors"
            aria-label="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
