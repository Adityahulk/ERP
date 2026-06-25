import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import * as ctrl from '../controllers/utilitiesController';

const router = Router();
router.use(verifyToken);

router.get('/health-check', requireMinRole('manager'), ctrl.runHealthCheck);

router.get('/financial-year/status', ctrl.getFinancialYearStatus);
router.post('/financial-year/close', requireMinRole('company_admin'), ctrl.closeFinancialYear);
router.delete('/financial-year/lock/:id', requireMinRole('company_admin'), ctrl.reopenFinancialYear);

router.get('/barcode/generate', ctrl.generateBarcodeImage);

router.post('/items/bulk-update', requireMinRole('manager'), ctrl.bulkUpdateItems);
router.get('/items/export', ctrl.exportItems);

router.post('/parties/import', requireMinRole('manager'), ctrl.importParties);

router.get('/salesmen', ctrl.listSalesmen);
router.post('/salesmen', requireMinRole('manager'), ctrl.createSalesman);
router.post('/salesmen/visits', ctrl.logSalesmanVisit);
router.get('/salesmen/:id/visits', ctrl.getSalesmanVisits);

router.get('/accountant-invites', requireMinRole('company_admin'), ctrl.listAccountantInvites);
router.post('/accountant-invites', requireMinRole('company_admin'), ctrl.inviteAccountant);
router.delete('/accountant-invites/:id', requireMinRole('company_admin'), ctrl.revokeAccountantInvite);

export default router;
