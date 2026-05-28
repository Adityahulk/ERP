import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import * as printSettingsCtrl from '../controllers/printSettingsController';

const router = Router();

router.use(verifyToken);

router.get('/', printSettingsCtrl.getPrintSettings);
router.put('/', requireMinRole('company_admin'), printSettingsCtrl.updatePrintSettings);

export default router;
