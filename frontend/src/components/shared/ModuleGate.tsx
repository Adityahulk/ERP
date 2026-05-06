import { Lock, ArrowUpRight } from 'lucide-react';
import { useModuleGuard } from '@/hooks/useModuleGuard';

interface ModuleGateProps {
  featureKey: string;
  featureLabel: string;
  children: React.ReactNode;
}

/**
 * Wraps a page/component and shows an "upgrade plan" prompt if the
 * current license tier does not include the required feature.
 */
export default function ModuleGate({ featureKey, featureLabel, children }: ModuleGateProps) {
  const { allowed, tierDisplayName } = useModuleGuard(featureKey);

  if (allowed) {
    return <>{children}</>;
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-8">
      <div className="w-16 h-16 rounded-2xl bg-violet-100 flex items-center justify-center mb-5">
        <Lock className="w-8 h-8 text-violet-500" />
      </div>
      <h2 className="text-2xl font-bold text-slate-800 mb-2">{featureLabel} is not in your plan</h2>
      <p className="text-slate-500 max-w-md mb-6">
        Your current <strong>{tierDisplayName}</strong> plan does not include{' '}
        <strong>{featureLabel}</strong>. Upgrade your license to unlock this module.
      </p>
      <div className="flex flex-col sm:flex-row gap-3">
        <a
          href="tel:+916355997080"
          className="inline-flex items-center gap-2 px-6 py-3 bg-violet-600 hover:bg-violet-700 text-white rounded-xl font-semibold transition-colors"
        >
          Call to Upgrade
          <ArrowUpRight className="w-4 h-4" />
        </a>
        <a
          href="mailto:support@microtechniqueit.com"
          className="inline-flex items-center gap-2 px-6 py-3 border-2 border-violet-200 hover:border-violet-400 text-violet-700 rounded-xl font-semibold transition-colors"
        >
          Email Sales
        </a>
      </div>
    </div>
  );
}
