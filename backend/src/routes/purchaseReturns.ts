import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import * as ctrl from '../controllers/purchaseReturnController';

const router = Router();
router.use(verifyToken);

router.get('/', ctrl.listPurchaseReturns);
router.get('/:id', ctrl.getPurchaseReturn);
router.post('/', ctrl.createPurchaseReturn);
router.post('/:id/refund', ctrl.recordPurchaseReturnRefund);

export default router;
