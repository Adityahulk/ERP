import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import * as ctrl from '../controllers/posController';

const router = Router();
router.use(verifyToken);

router.get('/held-bills', ctrl.listHeldBills);
router.post('/held-bills', ctrl.holdBill);
router.post('/held-bills/:id/resume', ctrl.resumeBill);
router.delete('/held-bills/:id', ctrl.voidHeldBill);

router.get('/reports/cashier-wise', requireMinRole('manager'), ctrl.cashierWiseSales);
router.get('/reports/counter-wise', requireMinRole('manager'), ctrl.counterWiseSales);
router.get('/reports/hourly', requireMinRole('manager'), ctrl.hourlyBillingReport);

export default router;
