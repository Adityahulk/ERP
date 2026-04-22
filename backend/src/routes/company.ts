import { Router } from 'express';
import { z } from 'zod';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import { validateBody } from '../middleware/validate';
import { uploadLogo, uploadSignature } from '../services/fileUpload';
import * as companyCtrl from '../controllers/companyController';

const router = Router();

router.use(verifyToken);

router.get('/', companyCtrl.getCompany);
router.patch('/', requireMinRole('company_admin'), companyCtrl.updateCompany);
router.post('/logo', requireMinRole('company_admin'), uploadLogo, companyCtrl.uploadLogoHandler);
router.post('/signature', requireMinRole('company_admin'), uploadSignature, companyCtrl.uploadSignatureHandler);

export default router;
