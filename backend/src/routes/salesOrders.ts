import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import * as ctrl from '../controllers/saleOrderController';

const router = Router();
router.use(verifyToken);

router.get('/', ctrl.listSaleOrders);
router.post('/', ctrl.createSaleOrder);
router.get('/:id', ctrl.getSaleOrder);
router.patch('/:id/status', ctrl.updateSaleOrderStatus);

export default router;
