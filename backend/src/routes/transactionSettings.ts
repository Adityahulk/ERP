import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import * as ctrl from '../modules/settings/transaction/transaction-settings.controller';

const router = Router();
router.use(verifyToken);

router.get('/', ctrl.getAll);
router.put('/', ctrl.updateMain);
router.get('/prefixes', ctrl.getPrefixes);
router.put('/prefixes', ctrl.updatePrefixes);
router.get('/terms', ctrl.getTerms);
router.post('/terms', ctrl.createTerm);
router.put('/terms/:id', ctrl.updateTerm);
router.delete('/terms/:id', ctrl.deleteTerm);
router.get('/additional-fields', ctrl.getAdditionalFields);
router.put('/additional-fields', ctrl.updateAdditionalFields);
router.get('/transportation', ctrl.getTransportation);
router.put('/transportation', ctrl.updateTransportation);
router.get('/charges', ctrl.getCharges);
router.put('/charges', ctrl.updateCharges);

export default router;
