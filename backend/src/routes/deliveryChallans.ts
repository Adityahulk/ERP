import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import * as ctrl from '../controllers/deliveryChallanController';

const router = Router();
router.use(verifyToken);

router.get('/', ctrl.listDeliveryChallans);
router.post('/', ctrl.createDeliveryChallan);
router.get('/:id', ctrl.getDeliveryChallan);
router.patch('/:id/status', ctrl.updateChallanStatus);
router.post('/:id/convert', ctrl.convertChallanToInvoice);

export default router;
