import { Request, Response, NextFunction } from 'express';
import { query } from '../config/db';
import { redis } from '../config/redis';

/**
 * Which feature_key each module requires.
 * If no entry here, the module is always allowed (core modules).
 */
const MODULE_FEATURE_MAP: Record<string, string> = {
  hr: 'hr',
  attendance: 'hr',
  leaves: 'hr',
  employees: 'hr',
  'gst-filing': 'gst_filing',
  gst: 'gst_filing',
  expenses: 'expenses',
  bom: 'manufacturing',
  production: 'manufacturing',
  'job-work': 'job_work',
  ocr: 'ocr',
  wholesale: 'wholesale',
  reports: 'basic_reports',
};

/**
 * Fetch allowed feature_keys for a company's license tier.
 * Results are cached in Redis for 5 minutes to avoid repeated DB hits.
 */
async function getCompanyAllowedFeatures(companyId: string): Promise<Set<string>> {
  const cacheKey = `tier_features:${companyId}`;
  const cached = await redis.get(cacheKey);

  if (cached) {
    return new Set(JSON.parse(cached));
  }

  const result = await query(
    `SELECT ltf.feature_key
     FROM companies c
     JOIN licenses lic ON lic.id = c.license_id AND lic.is_deleted = false AND lic.status = 'active'
     JOIN license_tier_features ltf ON ltf.tier_id = lic.tier_id AND ltf.is_included = true
     WHERE c.id = $1 AND c.is_deleted = false AND c.is_active = true`,
    [companyId]
  );

  const features = result.rows.map((r: any) => r.feature_key);

  // Cache for 5 minutes
  await redis.setex(cacheKey, 5 * 60, JSON.stringify(features));

  return new Set(features);
}

/**
 * Clear cached tier features for a company (call on license activation/revoke).
 */
export async function clearTierFeaturesCache(companyId: string): Promise<void> {
  await redis.del(`tier_features:${companyId}`);
}

/**
 * Module guard middleware — checks if the company's license tier includes this module.
 *
 * Usage: router.use('/hr', moduleGuard('hr'), hrRoutes)
 */
export function moduleGuard(moduleName: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    // super_admin bypasses all module guards
    if (req.user.role === 'super_admin') {
      next();
      return;
    }

    const requiredFeature = MODULE_FEATURE_MAP[moduleName];

    // Module has no feature requirement — always allowed
    if (!requiredFeature) {
      next();
      return;
    }

    try {
      const companyId = req.user.company_id;
      if (!companyId) {
        res.status(401).json({ success: false, error: 'Company context required' });
        return;
      }

      // Companies without a license_id get unrestricted access (demo / legacy)
      const companyResult = await query(
        'SELECT license_id FROM companies WHERE id = $1 AND is_deleted = false',
        [companyId]
      );

      const company = companyResult.rows[0];
      if (!company || !company.license_id) {
        next();
        return;
      }

      const allowedFeatures = await getCompanyAllowedFeatures(companyId);

      if (!allowedFeatures.has(requiredFeature)) {
        res.status(403).json({
          success: false,
          error: `This module (${moduleName}) is not included in your current license plan. Please upgrade to access it.`,
          code: 'MODULE_NOT_IN_PLAN',
          module: moduleName,
          required_feature: requiredFeature,
        });
        return;
      }

      next();
    } catch (err: any) {
      // On unexpected errors, allow access rather than blocking (fail-open for uptime)
      next();
    }
  };
}

/**
 * Company scoping middleware — ensures company_id is always in the query context.
 */
export function companyScope(req: Request, res: Response, next: NextFunction): void {
  if (!req.user?.company_id) {
    res.status(401).json({ success: false, error: 'Company context required' });
    return;
  }

  (req as any).companyId = req.user.company_id;
  next();
}
