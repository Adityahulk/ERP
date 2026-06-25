import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import * as ctrl from '../controllers/gstController';

const router = Router();
router.use(verifyToken);

router.get('/summary', ctrl.getGSTSummary);
router.get('/gstr1', ctrl.getGSTR1);
router.get('/gstr1/export', ctrl.exportGSTR1);
router.get('/gstr2a-reconciliation', ctrl.getGSTR2AReconciliation);
router.get('/gstr2', ctrl.getGSTR2);
router.get('/rate-report', ctrl.getGstRateReport);
router.get('/form-27eq', ctrl.getForm27EQ);
router.get('/tds-payable', ctrl.getTdsPayable);
router.get('/eligibility', ctrl.getGstEligibility);
router.patch('/registration-type', ctrl.setGstRegistrationType);
router.get('/gstr4', ctrl.getGSTR4);
router.get('/gstr5', ctrl.getGSTR5);
router.get('/gstr6', ctrl.getGSTR6);
router.get('/gstr7', ctrl.getGSTR7);
router.get('/gstr8', ctrl.getGSTR8);
router.get('/gstr9c', ctrl.getGSTR9C);
router.get('/validation', ctrl.getGstValidation);
router.get('/dashboard', ctrl.getGstDashboard);
router.get('/gstr3b', ctrl.getGSTR3B);
router.get('/gstr3b/export', ctrl.exportGSTR3B);
router.get('/hsn-summary', ctrl.getHSNSummary);
router.get('/input-credit', ctrl.getInputCredit);

export default router;
