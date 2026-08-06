import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import * as ctrl from '../modules/settings/transaction/transaction-settings.controller';

const router = Router();
router.use(verifyToken);

router.get('/', ctrl.getAll);
router.put('/', requireMinRole('company_admin'), ctrl.updateMain);
router.get('/prefixes', ctrl.getPrefixes);
router.put('/prefixes', requireMinRole('company_admin'), ctrl.updatePrefixes);
router.get('/terms', ctrl.getTerms);
router.post('/terms', requireMinRole('company_admin'), ctrl.createTerm);
router.put('/terms/:id', requireMinRole('company_admin'), ctrl.updateTerm);
router.delete('/terms/:id', requireMinRole('company_admin'), ctrl.deleteTerm);
router.get('/additional-fields', ctrl.getAdditionalFields);
router.put('/additional-fields', requireMinRole('company_admin'), ctrl.updateAdditionalFields);
router.get('/transportation', ctrl.getTransportation);
router.put('/transportation', requireMinRole('company_admin'), ctrl.updateTransportation);
router.get('/charges', ctrl.getCharges);
router.put('/charges', requireMinRole('company_admin'), ctrl.updateCharges);

export default router;
