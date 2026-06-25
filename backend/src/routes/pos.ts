import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import * as ctrl from '../controllers/posController';
import * as qctrl from '../controllers/posQuickActionsController';

const router = Router();
router.use(verifyToken);

router.get('/held-bills', ctrl.listHeldBills);
router.post('/held-bills', ctrl.holdBill);
router.post('/held-bills/:id/resume', ctrl.resumeBill);
router.delete('/held-bills/:id', ctrl.voidHeldBill);

router.get('/reports/cashier-wise', requireMinRole('manager'), ctrl.cashierWiseSales);
router.get('/reports/counter-wise', requireMinRole('manager'), ctrl.counterWiseSales);
router.get('/reports/hourly', requireMinRole('manager'), ctrl.hourlyBillingReport);
router.get('/dashboard-widgets', ctrl.getDashboardWidgets);

router.get('/invoices/lookup', qctrl.lookupInvoice);
router.get('/invoices/:id/full', qctrl.getInvoiceFull);
router.get('/invoices/:id/duplicate-draft', qctrl.getDuplicateBillDraft);
router.post('/invoices/:id/void', requireMinRole('manager'), qctrl.voidBill);
router.post('/invoices/:id/exchange', qctrl.exchangeBill);

export default router;
