import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import * as ctrl from '../controllers/paymentController';

const router = Router();
router.use(verifyToken);

router.post('/', requireMinRole('manager'), ctrl.createPayment);
router.get('/', ctrl.listPayments);
router.get('/:id', ctrl.getPayment);
router.post('/:id/allocate', requireMinRole('manager'), ctrl.allocatePayment);
router.delete('/:id', requireMinRole('manager'), ctrl.deletePayment);

export default router;
