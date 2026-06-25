import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import * as ctrl from '../controllers/couponController';

const router = Router();
router.use(verifyToken);

router.post('/validate', ctrl.validateCoupon);
router.get('/', requireMinRole('manager'), ctrl.listCoupons);
router.post('/', requireMinRole('manager'), ctrl.createCoupon);
router.delete('/:id', requireMinRole('manager'), ctrl.deactivateCoupon);

export default router;
