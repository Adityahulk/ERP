import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import * as ctrl from '../controllers/paymentController';

const router = Router();
router.use(verifyToken);

router.post('/', ctrl.createPayment);
router.get('/', ctrl.listPayments);
router.get('/:id', ctrl.getPayment);
router.post('/:id/allocate', ctrl.allocatePayment);
router.delete('/:id', ctrl.deletePayment);

export default router;
