import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import * as ctrl from '../controllers/gstController';

const router = Router();
router.use(verifyToken);

router.get('/summary', ctrl.getGSTSummary);
router.get('/gstr1', ctrl.getGSTR1);
router.get('/gstr1/export', ctrl.exportGSTR1);
router.get('/gstr2a-reconciliation', ctrl.getGSTR2AReconciliation);
router.get('/gstr3b', ctrl.getGSTR3B);
router.get('/gstr3b/export', ctrl.exportGSTR3B);
router.get('/hsn-summary', ctrl.getHSNSummary);
router.get('/input-credit', ctrl.getInputCredit);
router.get('/eway-bill/eligible', ctrl.getEwayBillEligible);

export default router;
