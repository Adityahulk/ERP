import { Router } from 'express';
import { z } from 'zod';
import { validateBody, validateQuery } from '../middleware/validate';
import { verifyToken } from '../middleware/auth';
import { verifyRegistrantToken } from '../middleware/registrantAuth';
import { requireRole } from '../middleware/role';
import {
  getLicenseTiers,
  requestLicense,
  getMyLicenses,
  getLicenseDetail,
  activateLicense,
  adminListLicenses,
  revokeLicense,
} from '../controllers/licenseController';

const router = Router();

const requestSchema = z.object({
  tier_id: z.string().uuid(),
});

const activateSchema = z.object({
  company_name: z.string().min(2).max(500),
  admin_name: z.string().min(2).max(500),
  admin_email: z.string().email(),
  admin_password: z.string().min(8).max(100),
  expires_days: z.number().int().positive().optional(),
  notes: z.string().max(1000).optional(),
});

// Public
router.get('/tiers', getLicenseTiers);

// Registrant-authenticated routes
router.post('/request', verifyRegistrantToken, validateBody(requestSchema), requestLicense);
router.get('/', verifyRegistrantToken, getMyLicenses);
router.get('/:id', verifyRegistrantToken, getLicenseDetail);

// Super-admin routes (ERP user JWT)
router.get('/admin/all', verifyToken, requireRole('super_admin'), adminListLicenses);
router.post('/admin/:id/activate', verifyToken, requireRole('super_admin'), validateBody(activateSchema), activateLicense);
router.put('/admin/:id/revoke', verifyToken, requireRole('super_admin'), revokeLicense);

export default router;
