import { Router } from 'express';
import { z } from 'zod';
import { verifyToken } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { validateBody, validateQuery } from '../middleware/validate';
import { activateLicense, revokeLicense } from '../controllers/licenseController';
import {
  getDashboardStats,
  getLicenseTiersSuper,
  getAllLicenses,
  getLicenseDetailSuper,
  extendLicense,
  updateLicensePlanSuper,
  getAllCompanies,
  getCompanyDetailSuper,
  addUserToCompany,
  toggleUserActive,
} from '../controllers/superAdminController';

const router = Router();
router.use(verifyToken, requireRole('super_admin'));

const activateSchema = z.object({
  company_name: z.string().min(2).max(500),
  admin_name: z.string().min(2).max(500),
  admin_email: z.string().email(),
  admin_password: z.string().min(8).max(100),
  expires_days: z.coerce.number().int().positive().optional(),
  notes: z.string().max(1000).optional(),
});

const licensesQuerySchema = z.object({
  status: z.enum(['all', 'pending', 'active', 'expired', 'trial', 'expired_trial', 'revoked']).optional().default('all'),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  q: z.string().optional(),
});

const revokeSchema = z.object({
  reason: z.string().max(2000).optional(),
});

const extendSchema = z.object({
  days: z.coerce.number().int().positive(),
});

const planChangeSchema = z.object({
  tier_id: z.string().uuid(),
  status: z.enum(['active', 'trial']).optional(),
  expires_days: z.coerce.number().int().positive().optional(),
  expires_at: z.string().optional(),
  notes: z.string().max(2000).optional(),
});

const addUserSchema = z.object({
  name: z.string().min(1).max(500),
  email: z.string().email(),
  password: z.string().min(6).max(100),
  role: z.enum([
    'company_admin',
    'accountant',
    'manager',
    'cashier',
    'staff',
    'warehouse',
    'sales',
    'purchase',
  ]),
});

const companiesQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  q: z.string().optional(),
});

router.get('/stats', getDashboardStats);
router.get('/license-tiers', getLicenseTiersSuper);
router.get('/licenses', validateQuery(licensesQuerySchema), getAllLicenses);
router.get('/licenses/:id', getLicenseDetailSuper);
router.post('/licenses/:id/activate', validateBody(activateSchema), activateLicense);
router.put('/licenses/:id/revoke', validateBody(revokeSchema), revokeLicense);
router.put('/licenses/:id/extend', validateBody(extendSchema), extendLicense);
router.put('/licenses/:id/plan', validateBody(planChangeSchema), updateLicensePlanSuper);

router.get('/companies', validateQuery(companiesQuerySchema), getAllCompanies);
router.get('/companies/:id', getCompanyDetailSuper);
router.post('/companies/:id/users', validateBody(addUserSchema), addUserToCompany);

router.put('/users/:userId/toggle', toggleUserActive);

export default router;
