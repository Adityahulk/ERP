import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import * as taxSettingsCtrl from '../controllers/taxSettingsController';

const router = Router();

router.use(verifyToken);

router.get('/', taxSettingsCtrl.getTaxSettings);
router.put('/', requireMinRole('company_admin'), taxSettingsCtrl.updateTaxSlabs);
router.post('/custom', requireMinRole('company_admin'), taxSettingsCtrl.createCustomTaxRate);
router.put('/custom/:id', requireMinRole('company_admin'), taxSettingsCtrl.updateCustomTaxRate);
router.delete('/custom/:id', requireMinRole('company_admin'), taxSettingsCtrl.deleteCustomTaxRate);
router.post('/groups', requireMinRole('company_admin'), taxSettingsCtrl.createTaxGroup);
router.put('/groups/:id', requireMinRole('company_admin'), taxSettingsCtrl.updateTaxGroup);
router.delete('/groups/:id', requireMinRole('company_admin'), taxSettingsCtrl.deleteTaxGroup);

export default router;
