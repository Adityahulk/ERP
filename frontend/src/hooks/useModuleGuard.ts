import { useAuthStore } from '@/store/authStore';

/**
 * Tier → feature keys that are included.
 * Mirrors `license_tier_features` from migration `010_licensing_system.sql`.
 */
const TIER_FEATURES: Record<string, string[]> = {
  silver: ['invoicing', 'inventory', 'purchases', 'parties', 'basic_reports'],
  gold: ['invoicing', 'inventory', 'purchases', 'parties', 'basic_reports', 'gst_filing', 'expenses', 'ocr'],
  diamond: ['invoicing', 'inventory', 'purchases', 'parties', 'basic_reports', 'gst_filing', 'expenses', 'ocr', 'hr', 'manufacturing', 'job_work', 'wholesale'],
};

export function useModuleGuard(featureKey: string): { allowed: boolean; tierName: string | null; tierDisplayName: string | null } {
  const { license } = useAuthStore();

  // No license (legacy/unlicensed company) → unrestricted
  if (!license) {
    return { allowed: true, tierName: null, tierDisplayName: null };
  }

  // Trial: full Diamond access while not expired; blocked when expired
  if (license.status === 'trial') {
    const expired = (license.trial_days_remaining ?? 1) <= 0;
    if (!expired) {
      return { allowed: true, tierName: 'trial', tierDisplayName: 'Free Trial' };
    }
    return { allowed: false, tierName: 'trial', tierDisplayName: 'Free Trial' };
  }

  // Non-active paid license → block all gated modules
  if (license.status !== 'active') {
    return { allowed: false, tierName: license.tier_name, tierDisplayName: license.tier_display_name };
  }

  const tierKey = (license.tier_name || '').toLowerCase().trim();
  const tierFeatures = TIER_FEATURES[tierKey] ?? [];
  return {
    allowed: tierFeatures.includes(featureKey),
    tierName: tierKey || license.tier_name,
    tierDisplayName: license.tier_display_name,
  };
}
