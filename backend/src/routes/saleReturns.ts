import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import * as ctrl from '../controllers/saleReturnController';

const router = Router();
router.use(verifyToken);

router.get('/', ctrl.listSaleReturns);
router.post('/', requireMinRole('staff'), ctrl.createSaleReturn);
router.get('/:id/pdf', ctrl.getSaleReturnPDF);
router.post('/:id/email', requireMinRole('staff'), ctrl.emailSaleReturn);
router.get('/:id', ctrl.getSaleReturn);
router.put('/:id', requireMinRole('manager'), ctrl.updateSaleReturn);
router.patch('/:id/cancel', requireMinRole('manager'), ctrl.cancelSaleReturn);
router.delete('/:id', requireMinRole('manager'), ctrl.deleteSaleReturn);

export default router;
