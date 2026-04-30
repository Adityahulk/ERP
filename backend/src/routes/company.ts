import { Router } from 'express';
import { z } from 'zod';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import { validateBody } from '../middleware/validate';
import { uploadLogo, uploadSignature } from '../services/fileUpload';
import * as companyCtrl from '../controllers/companyController';

const router = Router();

router.use(verifyToken);

const onboardingBody = z.object({
  company: z.object({
    name: z.string().min(1).max(500),
    business_type: z.string().max(100).optional().nullable(),
    gstin: z.string().max(15).optional().nullable(),
    state_code: z.string().min(2).max(5),
  }),
  location: z.object({
    name: z.string().min(1).max(500),
    city: z.string().max(200).optional().nullable(),
    pincode: z.string().max(10).optional().nullable(),
  }),
  seed: z
    .object({
      items: z.boolean().optional(),
      coa: z.boolean().optional(),
      leaves: z.boolean().optional(),
    })
    .optional(),
});

const deleteWorkspaceBody = z.object({
  confirm: z.literal('DELETE-MY-COMPANY'),
});

router.get('/', companyCtrl.getCompany);
router.get('/gstin/:gstin', companyCtrl.lookupGstin);
router.get('/bank-accounts', companyCtrl.listBankAccounts);
router.post('/bank-accounts', requireMinRole('company_admin'), companyCtrl.upsertBankAccount);
router.patch('/bank-accounts/:id', requireMinRole('company_admin'), companyCtrl.upsertBankAccount);
router.delete('/bank-accounts/:id', requireMinRole('company_admin'), companyCtrl.deleteBankAccount);
router.patch('/', requireMinRole('company_admin'), companyCtrl.updateCompany);
router.patch('/onboarding', validateBody(onboardingBody), companyCtrl.completeOnboarding);
router.post(
  '/delete-workspace',
  requireMinRole('company_admin'),
  validateBody(deleteWorkspaceBody),
  companyCtrl.softDeleteCompany,
);
router.post('/logo', requireMinRole('company_admin'), uploadLogo, companyCtrl.uploadLogoHandler);
router.post('/signature', requireMinRole('company_admin'), uploadSignature, companyCtrl.uploadSignatureHandler);

export default router;
