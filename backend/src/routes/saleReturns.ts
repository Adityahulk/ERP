import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import * as ctrl from '../controllers/saleReturnController';

const router = Router();
router.use(verifyToken);

router.get('/', ctrl.listSaleReturns);
router.post('/', ctrl.createSaleReturn);
router.put('/:id', ctrl.updateSaleReturn);
router.post('/:id/refund', ctrl.recordSaleReturnRefund);

export default router;
