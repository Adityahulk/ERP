import { useAuthStore } from '@/store/authStore';

/**
 * Tier → feature keys that are included.
 * Mirrors the backend seed data in 010_licensing_system.sql.
 */
const TIER_FEATURES: Record<string, string[]> = {
  silver: ['invoicing', 'inventory', 'purchases', 'parties', 'basic_reports'],
  gold: ['invoicing', 'inventory', 'purchases', 'parties', 'basic_reports', 'gst_filing', 'expenses', 'ocr'],
  diamond: ['invoicing', 'inventory', 'purchases', 'parties', 'basic_reports', 'gst_filing', 'expenses', 'ocr', 'hr', 'manufacturing', 'job_work', 'wholesale'],
};

/**
 * Returns { allowed: boolean, tierName: string | null }
 * for a given feature key.
 *
 * If no license in store (demo / legacy company), always returns allowed: true.
 */
export function useModuleGuard(featureKey: string): { allowed: boolean; tierName: string | null; tierDisplayName: string | null } {
  const { license } = useAuthStore();

  if (!license || license.status !== 'active') {
    return { allowed: true, tierName: null, tierDisplayName: null };
  }

  const tierFeatures = TIER_FEATURES[license.tier_name] ?? [];
  const allowed = tierFeatures.includes(featureKey);

  return {
    allowed,
    tierName: license.tier_name,
    tierDisplayName: license.tier_display_name,
  };
}
