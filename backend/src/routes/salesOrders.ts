import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import * as ctrl from '../controllers/saleOrderController';

const router = Router();
router.use(verifyToken);

router.get('/', ctrl.listSaleOrders);
router.post('/', requireMinRole('staff'), ctrl.createSaleOrder);
router.get('/:id', ctrl.getSaleOrder);
router.get('/:id/pdf', ctrl.getSaleOrderPDF);
router.post('/:id/email', requireMinRole('staff'), ctrl.emailSaleOrder);
router.put('/:id', requireMinRole('manager'), ctrl.updateSaleOrder);
router.patch('/:id/status', requireMinRole('manager'), ctrl.updateSaleOrderStatus);
router.delete('/:id', requireMinRole('manager'), ctrl.deleteSaleOrder);

export default router;
