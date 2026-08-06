import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import * as printSettingsCtrl from '../controllers/printSettingsController';

const router = Router();

router.use(verifyToken);

router.get('/', printSettingsCtrl.getPrintSettings);
router.put('/', printSettingsCtrl.updatePrintSettings);

export default router;
